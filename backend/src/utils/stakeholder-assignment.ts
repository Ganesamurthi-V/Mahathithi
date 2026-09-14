import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { canonicalizeDistricts } from './district-scope';
import { logger } from './logger';

/**
 * Work assignment: each enumerator holds a bounded, exclusive set of stakeholders.
 *
 * An enumerator may hold at most WORK_QUOTA OPEN stakeholders at a time. They are
 * claimed from the unassigned pool in the enumerator's own districts, and as
 * surveys are completed the held count falls and the next top-up refills it.
 *
 * This replaced a derived modulo partition. See the migration
 * 20260911_stakeholder_work_assignment for why: the modulo could not express a cap,
 * and every slice silently re-cut whenever an enumerator joined or left a district.
 */

/**
 * How many OPEN stakeholders one enumerator may hold.
 *
 * A cap rather than "the whole district" because a device has to hold these
 * offline, and because a work queue nobody can finish is not a work queue.
 */
export const WORK_QUOTA = 5000;

export interface ClaimResult {
  /** Rows newly claimed by this call. */
  claimed: number;
  /** OPEN stakeholders this enumerator holds after claiming. */
  held: number;
  quota: number;
  /** Unassigned OPEN rows still available across their districts. */
  poolRemaining: number;
  /** True when the quota is full, so the client need not ask again yet. */
  full: boolean;
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
    return { claimed: 0, held: 0, quota, poolRemaining: 0, full: false };
  }

  const held = await countHeld(enumeratorId);
  const want = quota - held;

  if (want <= 0) {
    return {
      claimed: 0,
      held,
      quota,
      poolRemaining: await countPool(canonical),
      full: true,
    };
  }

  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    WITH picked AS (
      SELECT id
      FROM stakeholders
      WHERE assigned_to_id IS NULL
        AND status = 'OPEN'::"StakeholderStatus"
        AND district IN (${Prisma.join(canonical)})
      ORDER BY priority_weight DESC NULLS LAST, primary_key_id ASC
      LIMIT ${want}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE stakeholders s
    SET assigned_to_id = ${enumeratorId},
        assigned_at = NOW(),
        updated_at = NOW()
    FROM picked
    WHERE s.id = picked.id
    RETURNING s.id
  `);

  const claimed = rows.length;
  const nowHeld = held + claimed;

  if (claimed > 0) {
    logger.info(
      `[assignment] enumerator ${enumeratorId} claimed ${claimed} stakeholder(s); holding ${nowHeld}/${quota}`
    );
  }

  return {
    claimed,
    held: nowHeld,
    quota,
    poolRemaining: await countPool(canonical),
    full: nowHeld >= quota,
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
