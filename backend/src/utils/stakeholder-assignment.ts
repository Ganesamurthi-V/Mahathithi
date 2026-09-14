import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { canonicalizeDistricts } from './district-scope';
import { logger } from './logger';

/**
 * Work assignment: each enumerator holds a bounded, exclusive, FAIR share.
 *
 * Two things have to be true at once, and a single flat cap cannot give both:
 *
 *   1. A batch must be small enough to carry offline and actually finish.
 *      WORK_QUOTA (5000) is the ceiling for that.
 *   2. Where several enumerators share a district, none may hoard it. A flat cap
 *      failed here: with 1980 open records and two enumerators, the first to sync
 *      claimed all 1980 — under the 5000 ceiling, so nothing stopped it — and the
 *      second was left with an empty queue.
 *
 * So the batch is a per-district FAIR SHARE:
 *
 *      share(d) = min(WORK_QUOTA, ceil(openTotal(d) / enumeratorsIn(d)))
 *
 *   30 000 open, 1 enumerator   -> min(5000, 30000)  = 5000   (5000 now, more later)
 *   30 000 open, 3 enumerators  -> min(5000, 10000)  = 5000   each
 *    1 980 open, 2 enumerators  -> min(5000,   990)  =  990   each
 *      100 open, 5 enumerators  -> min(5000,    20)  =   20   each
 *
 * The divisor is the district's TOTAL open count, not the unassigned remainder.
 * Using the remainder would shrink the share as colleagues claimed, so whoever
 * synced first would still end up with more — the same unfairness by a slower route.
 *
 * A share is a batch, not a lifetime allocation. Completing surveys closes those
 * records, they stop counting against the share, and the next top-up refills it —
 * which is how one enumerator works through a 30 000-record district 5000 at a time.
 *
 * This replaced a derived modulo partition. See the migration
 * 20260911_stakeholder_work_assignment for why: the modulo could not express a cap,
 * and every slice silently re-cut whenever an enumerator joined or left a district.
 */

/**
 * Hard ceiling on OPEN stakeholders one enumerator may hold at a time.
 *
 * A ceiling rather than "the whole district" because a device has to hold these
 * offline, and a work queue nobody can finish is not a work queue.
 */
export const WORK_QUOTA = 5000;

/** The fair share for one district, and the inputs it was derived from. */
export interface DistrictShare {
  district: string;
  /** OPEN records in the district, assigned or not. */
  openTotal: number;
  /** Active, non-admin enumerators assigned to it. */
  enumerators: number;
  /** min(WORK_QUOTA, ceil(openTotal / enumerators)) — the batch size. */
  share: number;
  /** OPEN records this enumerator already holds here. */
  held: number;
  /** Unassigned OPEN records left in the district. */
  pool: number;
}

export interface ClaimResult {
  /** Rows newly claimed by this call. */
  claimed: number;
  /** OPEN stakeholders this enumerator holds after claiming, across all districts. */
  held: number;
  /** The hard ceiling (WORK_QUOTA). */
  quota: number;
  /**
   * What this enumerator should hold once fully topped up: the sum of their
   * per-district shares, itself capped at WORK_QUOTA.
   *
   * Reported separately from `quota` so a client can say "990 of 990" rather than
   * "990 of 5000", which reads as an unfinished download.
   */
  target: number;
  /** Unassigned OPEN rows still available across their districts. */
  poolRemaining: number;
  /** True when nothing more can be claimed right now. */
  full: boolean;
  /** Per-district breakdown, so a thin queue has a visible explanation. */
  shares: DistrictShare[];
}

/** OPEN stakeholders currently claimed by this enumerator. */
export async function countHeld(enumeratorId: string): Promise<number> {
  return prisma.stakeholder.count({
    where: { assignedToId: enumeratorId, status: 'OPEN' },
  });
}

/** Unassigned OPEN stakeholders left in these districts. */
export async function countPool(districts: string[]): Promise<number> {
  const canonical = await canonicalizeDistricts(districts);
  if (canonical.length === 0) return 0;
  return prisma.stakeholder.count({
    where: { district: { in: canonical }, assignedToId: null, status: 'OPEN' },
  });
}

/**
 * Work out the fair share for each of an enumerator's districts.
 *
 * WHO COUNTS AS A SHARER
 * Only active, non-admin enumerators assigned to the district. Counting an
 * inactive account would reserve a share nobody collects, shrinking everyone
 * else's for no reason; counting an admin would do the same, since they see whole
 * districts and hold no queue.
 *
 * The caller is always included, so the divisor is never zero for a district they
 * are assigned to — but it is floored at 1 anyway, because a divisor of zero here
 * would produce an infinite share and hand out the entire district.
 */
export async function getDistrictShares(
  enumeratorId: string,
  districts: string[],
): Promise<DistrictShare[]> {
  const canonical = await canonicalizeDistricts(districts);
  if (canonical.length === 0) return [];

  return Promise.all(
    canonical.map(async (district) => {
      const [openTotal, enumerators, held, pool] = await Promise.all([
        prisma.stakeholder.count({ where: { district, status: 'OPEN' } }),
        prisma.enumeratorDistrict.count({
          where: {
            district: { name: district },
            enumerator: { isActive: true, isAdmin: false },
          },
        }),
        prisma.stakeholder.count({
          where: { district, assignedToId: enumeratorId, status: 'OPEN' },
        }),
        prisma.stakeholder.count({
          where: { district, assignedToId: null, status: 'OPEN' },
        }),
      ]);

      const divisor = Math.max(1, enumerators);
      const share = Math.min(WORK_QUOTA, Math.ceil(openTotal / divisor));

      return { district, openTotal, enumerators: divisor, share, held, pool };
    })
  );
}

/**
 * Claim up to the remaining quota from the unassigned pool.
 *
 * RACE SAFETY IS THE ENTIRE POINT
 * Two devices topping up at the same moment must not be handed the same rows, or
 * the exclusivity this exists to provide is gone. A read-then-write would do
 * exactly that: both SELECT the same candidates, both UPDATE, and the second
 * silently steals from the first.
 *
 * So the candidate set is locked as it is selected, with FOR UPDATE SKIP LOCKED.
 * The second transaction steps over rows the first has locked and takes the next
 * ones instead, rather than blocking or overwriting. This is the standard
 * work-queue claim, and it is the reason this is raw SQL: Prisma has no way to
 * express row locking.
 *
 * The UPDATE also bumps updated_at by hand. Prisma's `@updatedAt` only applies to
 * writes made through Prisma, and the mobile delta feed finds new work by
 * `updated_at > cursor` — without this the freshly claimed rows would be invisible
 * to the very mechanism that is supposed to deliver them.
 *
 * Ordering by priority_weight then primary_key_id means the highest-value records
 * are handed out first and ties break deterministically, so two enumerators
 * claiming from the same district get adjacent, non-overlapping blocks.
 */
export async function claimStakeholders(
  enumeratorId: string,
  districts: string[],
  quota: number = WORK_QUOTA,
): Promise<ClaimResult> {
  const canonical = await canonicalizeDistricts(districts);

  if (canonical.length === 0) {
    return { claimed: 0, held: 0, quota, target: 0, poolRemaining: 0, full: false, shares: [] };
  }

  const shares = await getDistrictShares(enumeratorId, canonical);
  const heldBefore = shares.reduce((n, s) => n + s.held, 0);

  // The per-district shares are the fair allocation; WORK_QUOTA is still a hard
  // ceiling on top, so an enumerator covering several districts cannot end up
  // holding 3 x 5000 records on one phone.
  const target = Math.min(quota, shares.reduce((n, s) => n + s.share, 0));
  let globalRoom = quota - heldBefore;

  let claimed = 0;

  if (globalRoom > 0) {
    // Smallest share first. If the global ceiling runs out partway, the districts
    // that lose out are the big ones, which still have plenty left to claim next
    // time — whereas skipping a small district could leave it with no coverage at all.
    const ordered = [...shares].sort((a, b) => a.share - b.share);

    for (const s of ordered) {
      if (globalRoom <= 0) break;

      const districtRoom = s.share - s.held;
      const want = Math.min(districtRoom, globalRoom);
      if (want <= 0) continue;

      // One statement per district, because the LIMIT is per-district: a single
      // query across all of them could satisfy the whole amount from one district
      // and starve the others.
      const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        WITH picked AS (
          SELECT id
          FROM stakeholders
          WHERE assigned_to_id IS NULL
            AND status = 'OPEN'::"StakeholderStatus"
            AND district = ${s.district}
          ORDER BY priority_weight DESC NULLS LAST, primary_key_id ASC
          LIMIT ${want}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE stakeholders st
        SET assigned_to_id = ${enumeratorId},
            assigned_at = NOW(),
            updated_at = NOW()
        FROM picked
        WHERE st.id = picked.id
        RETURNING st.id
      `);

      claimed += rows.length;
      globalRoom -= rows.length;

      if (rows.length > 0) {
        logger.info(
          `[assignment] ${enumeratorId} claimed ${rows.length} in ${s.district} ` +
          `(share ${s.share} of ${s.openTotal} open / ${s.enumerators} enumerator(s), held ${s.held} -> ${s.held + rows.length})`
        );
      }
    }
  }

  // Re-read rather than adding up: a concurrent claimer may have taken rows this
  // call was aiming for, and SKIP LOCKED means that is expected rather than an error.
  const after = await getDistrictShares(enumeratorId, canonical);
  const held = after.reduce((n, s) => n + s.held, 0);
  const poolRemaining = after.reduce((n, s) => n + s.pool, 0);

  return {
    claimed,
    held,
    quota,
    target,
    poolRemaining,
    // Full when the fair share is met or the ceiling is reached — not merely when
    // the pool is empty, since more work appears as colleagues finish theirs.
    full: held >= target || held >= quota,
    shares: after,
  };
}

/**
 * Release an enumerator's claims on rows they have not finished.
 *
 * Used when an enumerator loses a district: the records they can no longer reach
 * must go back to the pool, or they would sit assigned to someone who cannot see
 * them and no one else could claim them — invisible, unsurveyable, and still
 * counted in the district total.
 *
 * CLOSED rows are left alone on purpose. Those represent completed field work and
 * the assignment is part of its provenance; releasing them would also make them
 * look claimable again.
 */
export async function releaseClaims(
  enumeratorId: string,
  districts?: string[],
): Promise<number> {
  const where: Prisma.StakeholderWhereInput = {
    assignedToId: enumeratorId,
    status: 'OPEN',
  };

  if (districts) {
    const canonical = await canonicalizeDistricts(districts);
    if (canonical.length === 0) return 0;
    where.district = { in: canonical };
  }

  const result = await prisma.stakeholder.updateMany({
    where,
    data: { assignedToId: null, assignedAt: null },
  });

  if (result.count > 0) {
    logger.info(
      `[assignment] released ${result.count} claim(s) from enumerator ${enumeratorId}` +
      (districts ? ` in ${districts.join(', ')}` : '')
    );
  }
  return result.count;
}

/**
 * Release claims that fall OUTSIDE the districts an enumerator still holds.
 *
 * Called after a reassignment. Passing the districts they keep is safer than
 * passing the ones they lost: if the caller computes the lost set wrongly, this
 * still cannot strand a row, because anything not in the keep-list is released.
 */
export async function releaseClaimsOutsideDistricts(
  enumeratorId: string,
  keepDistricts: string[],
): Promise<number> {
  const canonical = await canonicalizeDistricts(keepDistricts);

  const result = await prisma.stakeholder.updateMany({
    where: {
      assignedToId: enumeratorId,
      status: 'OPEN',
      ...(canonical.length > 0 ? { district: { notIn: canonical } } : {}),
    },
    data: { assignedToId: null, assignedAt: null },
  });

  if (result.count > 0) {
    logger.info(
      `[assignment] released ${result.count} out-of-district claim(s) from enumerator ${enumeratorId}`
    );
  }
  return result.count;
}
