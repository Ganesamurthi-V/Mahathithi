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

/**
 * Any Prisma handle — the global client, or a transaction client.
 *
 * Every read that a claim decision rests on must be able to run INSIDE the
 * claiming transaction. Run against the global client instead and it sees a
 * different snapshot from the UPDATE that follows, which is the whole reason the
 * quota was being handed out twice.
 */
type Db = Prisma.TransactionClient;

/**
 * Advisory lock namespaces. Two-argument `pg_advisory_xact_lock(ns, key)` keeps
 * an enumerator id that happens to hash to the same int as a district name from
 * being treated as the same lock.
 */
const LOCK_NS_ENUMERATOR = 1;
const LOCK_NS_DISTRICT = 2;

export interface ClaimResult {
  /** Rows newly claimed by this call. */
  claimed: number;
  /**
   * Rows taken back from over-share holders during this call so the caller had
   * something to claim. Usually 0.
   */
  reclaimed: number;
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
  db: Db = prisma,
): Promise<DistrictShare[]> {
  const canonical = await canonicalizeDistricts(districts);
  if (canonical.length === 0) return [];

  // Sequential, not Promise.all, when running inside a transaction: a Prisma
  // interactive transaction is one connection, so parallel queries on it merely
  // queue anyway, and fanning out per district multiplied that queue by four.
  const out: DistrictShare[] = [];
  for (const district of canonical) {
      const [openTotal, enumerators, held, pool] = [
        await db.stakeholder.count({ where: { district, status: 'OPEN' } }),
        await db.enumeratorDistrict.count({
          where: {
            district: { name: district },
            enumerator: { isActive: true, isAdmin: false },
          },
        }),
        await db.stakeholder.count({
          where: { district, assignedToId: enumeratorId, status: 'OPEN' },
        }),
        await db.stakeholder.count({
          where: { district, assignedToId: null, status: 'OPEN' },
        }),
      ];

      const divisor = Math.max(1, enumerators);
      const share = Math.min(WORK_QUOTA, Math.ceil(openTotal / divisor));

      out.push({ district, openTotal, enumerators: divisor, share, held, pool });
  }
  return out;
}

/**
 * Take back everything held ABOVE the current fair share in one district.
 *
 * WHY A CLAW-BACK IS NEEDED AT ALL
 * A share is computed when it is claimed, and the divisor is the number of
 * enumerators in the district — so every share already handed out shrinks the
 * moment another enumerator joins. Nothing used to act on that. The first claimer
 * kept the oversized batch they were legitimately given, the pool stayed empty, and
 * the new colleague's queue came back empty no matter how often they synced.
 * Sindhudurg showed it exactly: one enumerator held all 1980 open records, claimed
 * when they were the only one there, and the second enumerator could never get a
 * single row.
 *
 * WHAT IS SAFE TO TAKE BACK
 * Only OPEN rows with no survey attached. A stakeholder someone has already started
 * surveying stays with them regardless of share — moving it would strand
 * half-finished work and risk a second enumerator repeating the visit. CLOSED rows
 * are excluded by the same test and keep their assignment as provenance.
 *
 * WHICH ROWS GO FIRST
 * Lowest priority_weight first — the mirror image of how they were handed out
 * (priority DESC). An enumerator therefore loses the tail of their batch, the part
 * they would have reached last, and keeps their highest-value work.
 *
 * Every release records a revocation row, because releasing a claim is otherwise
 * invisible to the device holding it: the delta feed finds work by
 * `assigned_to_id = me`, so a released row silently drops out of the feed forever
 * and the device goes on offering it. See StakeholderRevocation.
 */
export async function releaseOverShare(
  district: string,
  db: Db = prisma,
  quota: number = WORK_QUOTA,
): Promise<number> {
  const rows = await db.$queryRaw<{ id: string; assigned_to_id: string }[]>(Prisma.sql`
    WITH sharers AS (
      SELECT GREATEST(1, COUNT(*))::int AS n
      FROM enumerator_districts ed
      JOIN districts d ON d.id = ed.district_id
      JOIN enumerators e ON e.id = ed.enumerator_id
      WHERE d.name = ${district}
        AND e.is_active = true
        AND e.is_admin = false
    ),
    totals AS (
      SELECT COUNT(*)::int AS open_total
      FROM stakeholders
      WHERE district = ${district}
        AND status = 'OPEN'::"StakeholderStatus"
    ),
    share AS (
      SELECT LEAST(${quota}::int, CEIL(t.open_total::numeric / s.n)::int) AS share
      FROM totals t CROSS JOIN sharers s
    ),
    -- Counts EVERY open row a holder has, including ones pinned by a survey, so
    -- the overage is measured against what they really hold.
    held_counts AS (
      SELECT assigned_to_id, COUNT(*)::int AS held
      FROM stakeholders
      WHERE district = ${district}
        AND status = 'OPEN'::"StakeholderStatus"
        AND assigned_to_id IS NOT NULL
      GROUP BY assigned_to_id
    ),
    -- ...but only untouched rows may actually be moved.
    releasable AS (
      SELECT st.id,
             st.assigned_to_id,
             ROW_NUMBER() OVER (
               PARTITION BY st.assigned_to_id
               ORDER BY st.priority_weight ASC NULLS FIRST, st.primary_key_id DESC
             ) AS rn
      FROM stakeholders st
      WHERE st.district = ${district}
        AND st.status = 'OPEN'::"StakeholderStatus"
        AND st.assigned_to_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM surveys sv WHERE sv.stakeholder_id = st.id)
    ),
    excess AS (
      SELECT r.id, r.assigned_to_id
      FROM releasable r
      JOIN held_counts h ON h.assigned_to_id = r.assigned_to_id
      CROSS JOIN share s
      WHERE h.held > s.share
        AND r.rn <= h.held - s.share
    )
    UPDATE stakeholders st
    SET assigned_to_id = NULL,
        assigned_at = NULL,
        updated_at = NOW()
    FROM excess
    WHERE st.id = excess.id
    RETURNING st.id, excess.assigned_to_id
  `);

  if (rows.length === 0) return 0;

  await recordRevocations(
    rows.map(r => ({ stakeholderId: r.id, enumeratorId: r.assigned_to_id })),
    `over fair share in ${district}`,
    db,
  );

  const perHolder = new Map<string, number>();
  for (const r of rows) perHolder.set(r.assigned_to_id, (perHolder.get(r.assigned_to_id) ?? 0) + 1);
  for (const [holder, n] of perHolder) {
    logger.info(`[assignment] reclaimed ${n} over-share row(s) in ${district} from ${holder}`);
  }

  return rows.length;
}

/**
 * Log claims taken away, so the delta feed can tell the device to drop them.
 *
 * Chunked because a release can span thousands of rows and a single INSERT with
 * that many parameter tuples exceeds what the driver will bind.
 */
async function recordRevocations(
  entries: Array<{ stakeholderId: string; enumeratorId: string }>,
  reason: string,
  db: Db = prisma,
): Promise<void> {
  const CHUNK = 1000;
  for (let i = 0; i < entries.length; i += CHUNK) {
    await db.stakeholderRevocation.createMany({
      data: entries.slice(i, i + CHUNK).map(e => ({ ...e, reason })),
    });
  }
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
 *
 * SKIP LOCKED IS NOT ENOUGH ON ITS OWN
 * It guarantees two claims never grab the same ROW. It says nothing about how many
 * rows each is allowed, and the quota check used to sit outside any transaction:
 * read held, decide room, then UPDATE. Two overlapping calls both read held = 0,
 * both concluded they had the full quota free, and each took a different full batch
 * — no row taken twice, every ceiling doubled.
 *
 * It happened constantly, because the claim endpoint is called both before the
 * initial download and again after each sync and is documented as safe to call
 * freely. Every enumerator in the district ended up holding exactly 10 000 rows,
 * twice the 5000 ceiling: Sanjana took 5000 at 05:47:51 and another 5000 at
 * 05:47:52; Sindhudurg's sole claimer took 990 twice and swallowed the district,
 * leaving the second enumerator there permanently empty.
 *
 * So the check and the claim now share one transaction, and the transaction opens
 * by taking advisory locks: the enumerator (a second claim for the same person
 * waits, then re-reads `held` and correctly finds no room) and each district it
 * touches. District locks also make the claw-back safe, since that writes rows
 * belonging to other enumerators.
 *
 * Lock order is fixed — enumerator first, then districts sorted by name — so two
 * claims can never hold the locks the other needs and deadlock.
 */
export async function claimStakeholders(
  enumeratorId: string,
  districts: string[],
  quota: number = WORK_QUOTA,
): Promise<ClaimResult> {
  const canonical = await canonicalizeDistricts(districts);

  if (canonical.length === 0) {
    return { claimed: 0, reclaimed: 0, held: 0, quota, target: 0, poolRemaining: 0, full: false, shares: [] };
  }

  return prisma.$transaction(
    async (tx) => claimWithin(tx, enumeratorId, canonical, quota),
    {
      // A batch can be 5000 rows across three districts; the default 5s ceiling
      // would abort mid-claim and roll the whole thing back.
      timeout: 120_000,
      maxWait: 30_000,
    },
  );
}

async function claimWithin(
  tx: Db,
  enumeratorId: string,
  canonical: string[],
  quota: number,
): Promise<ClaimResult> {
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${LOCK_NS_ENUMERATOR}::int, hashtext(${enumeratorId}))`
  );
  for (const district of [...canonical].sort()) {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(${LOCK_NS_DISTRICT}::int, hashtext(${district}))`
    );
  }

  // Claw back other people's overage only where the caller actually comes up short.
  // Running it unconditionally would churn assignments across the district on every
  // routine top-up for no gain.
  let reclaimed = 0;
  const before = await getDistrictShares(enumeratorId, canonical, tx);
  for (const s of before) {
    if (s.pool < s.share - s.held) {
      reclaimed += await releaseOverShare(s.district, tx, quota);
    }
  }

  const shares = reclaimed > 0
    ? await getDistrictShares(enumeratorId, canonical, tx)
    : before;
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
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
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
  const after = await getDistrictShares(enumeratorId, canonical, tx);
  const held = after.reduce((n, s) => n + s.held, 0);
  const poolRemaining = after.reduce((n, s) => n + s.pool, 0);

  return {
    claimed,
    reclaimed,
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

  // Read the ids before clearing them: once assigned_to_id is NULL there is no way
  // left to work out whose claim it was, and the device holding it still has to be
  // told to drop the row.
  const releasing = await prisma.stakeholder.findMany({ where, select: { id: true } });
  if (releasing.length === 0) return 0;

  const result = await prisma.stakeholder.updateMany({
    where,
    data: { assignedToId: null, assignedAt: null },
  });

  await recordRevocations(
    releasing.map(s => ({ stakeholderId: s.id, enumeratorId })),
    districts ? `claims released in ${districts.join(', ')}` : 'claims released',
  );

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

  const where: Prisma.StakeholderWhereInput = {
    assignedToId: enumeratorId,
    status: 'OPEN',
    ...(canonical.length > 0 ? { district: { notIn: canonical } } : {}),
  };

  // Captured before the update, for the same reason as in releaseClaims: the
  // ownership this revocation refers to is about to be erased.
  const releasing = await prisma.stakeholder.findMany({ where, select: { id: true } });
  if (releasing.length === 0) return 0;

  const result = await prisma.stakeholder.updateMany({
    where,
    data: { assignedToId: null, assignedAt: null },
  });

  await recordRevocations(
    releasing.map(s => ({ stakeholderId: s.id, enumeratorId })),
    'district no longer assigned',
  );

  if (result.count > 0) {
    logger.info(
      `[assignment] released ${result.count} out-of-district claim(s) from enumerator ${enumeratorId}`
    );
  }
  return result.count;
}

/**
 * Re-level a set of districts after their sharer count changes.
 *
 * Called when an enumerator is added to, or removed from, a district. Adding one
 * shrinks everyone's share immediately, and without this the existing holders would
 * keep their now-oversized batches until each happened to trigger a claw-back on a
 * top-up — which for the newcomer means an empty queue in the meantime.
 *
 * Takes the same district advisory lock the claim path uses, so a rebalance and a
 * concurrent claim cannot interleave and both act on stale counts.
 */
export async function rebalanceDistricts(districts: string[]): Promise<number> {
  const canonical = await canonicalizeDistricts(districts);
  if (canonical.length === 0) return 0;

  let released = 0;
  for (const district of [...canonical].sort()) {
    released += await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(${LOCK_NS_DISTRICT}::int, hashtext(${district}))`
        );
        return releaseOverShare(district, tx);
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  }
  return released;
}
