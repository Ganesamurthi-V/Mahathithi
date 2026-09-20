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

  // Parallel on purpose. These are four counts per district over a 295K-row table,
  // and the dashboard calls this on every load, outside any transaction — running
  // them in series made that 12 sequential round trips for a three-district
  // enumerator. Inside a transaction Prisma queues them on the single connection
  // anyway, so this is never worse there and materially better everywhere else.
  return Promise.all(
    canonical.map(async (district) => {
      const [openTotal, enumerators, held, pool] = await Promise.all([
        db.stakeholder.count({ where: { district, status: 'OPEN' } }),
        db.enumeratorDistrict.count({
          where: {
            district: { name: district },
            enumerator: { isActive: true, isAdmin: false },
          },
        }),
        db.stakeholder.count({
          where: { district, assignedToId: enumeratorId, status: 'OPEN' },
        }),
        db.stakeholder.count({
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
 * Bring one enumerator's TOTAL holding back under the global ceiling.
 *
 * The per-district claw-back cannot do this. It trims each district to that
 * district's share and knows nothing about the others, so somebody covering three
 * districts can sit at three times a share and still look correct everywhere it
 * checks. Hema_S was the live example: 2250 in Mumbai City plus 5000 in Mumbai
 * Suburban is at the share in both and 7250 in total, against a 5000 ceiling that
 * exists because one phone has to carry the batch offline.
 *
 * Releases lowest priority_weight first, across every district at once, so what goes
 * back is the work they would have reached last wherever it happens to sit. Rows
 * with a survey attached are never touched.
 */
export async function trimToGlobalQuota(
  enumeratorId: string,
  db: Db = prisma,
  quota: number = WORK_QUOTA,
): Promise<number> {
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    WITH held AS (
      SELECT COUNT(*)::int AS n
      FROM stakeholders
      WHERE assigned_to_id = ${enumeratorId}
        AND status = 'OPEN'::"StakeholderStatus"
    ),
    over AS (
      SELECT GREATEST(0, n - ${quota}::int) AS over FROM held
    ),
    releasable AS (
      SELECT st.id,
             ROW_NUMBER() OVER (
               ORDER BY st.priority_weight ASC NULLS FIRST, st.primary_key_id DESC
             ) AS rn
      FROM stakeholders st
      WHERE st.assigned_to_id = ${enumeratorId}
        AND st.status = 'OPEN'::"StakeholderStatus"
        AND NOT EXISTS (SELECT 1 FROM surveys sv WHERE sv.stakeholder_id = st.id)
    ),
    excess AS (
      SELECT r.id FROM releasable r CROSS JOIN over o WHERE r.rn <= o.over
    )
    UPDATE stakeholders st
    SET assigned_to_id = NULL,
        assigned_at = NULL,
        updated_at = NOW()
    FROM excess
    WHERE st.id = excess.id
    RETURNING st.id
  `);

  if (rows.length === 0) return 0;

  await recordRevocations(
    rows.map(r => ({ stakeholderId: r.id, enumeratorId })),
    'over global work quota',
    db,
  );

  logger.info(`[assignment] trimmed ${rows.length} row(s) from ${enumeratorId} to fit the ${quota} ceiling`);
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
      const got = await claimFromPool(tx, enumeratorId, s.district, want);

      claimed += got;
      globalRoom -= got;

      if (got > 0) {
        logger.info(
          `[assignment] ${enumeratorId} claimed ${got} in ${s.district} ` +
          `(share ${s.share} of ${s.openTotal} open / ${s.enumerators} enumerator(s), held ${s.held} -> ${s.held + got})`
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
 * Hand `want` unassigned OPEN rows in one district to one enumerator.
 *
 * Highest priority_weight first, ties broken by primary_key_id, so the most
 * valuable records go out first and two enumerators drawing from the same district
 * receive adjacent, non-overlapping blocks.
 *
 * FOR UPDATE SKIP LOCKED makes a concurrent draw step over rows this one has
 * locked rather than block on them or overwrite the claim. Note what it does NOT
 * do: it places no limit on how much each caller takes, which is why the quota
 * decision has to sit inside the same transaction as this call.
 *
 * updated_at is bumped by hand because Prisma's `@updatedAt` only fires for writes
 * made through Prisma, and the mobile delta feed finds new work by
 * `updated_at > cursor` — without it the freshly claimed rows would be invisible to
 * the very mechanism meant to deliver them.
 */
async function claimFromPool(
  tx: Db,
  enumeratorId: string,
  district: string,
  want: number,
): Promise<number> {
  if (want <= 0) return 0;

  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    WITH picked AS (
      SELECT id
      FROM stakeholders
      WHERE assigned_to_id IS NULL
        AND status = 'OPEN'::"StakeholderStatus"
        AND district = ${district}
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

  return rows.length;
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

  // One transaction over all three steps. Read, release, then record — and if the
  // record does not land, the release must not either: the device would be holding
  // rows the server has taken away with nothing left to tell it so, and only a
  // reinstall would clear them.
  const result = await prisma.$transaction(
    async (tx) => {
      // Read the ids before clearing them: once assigned_to_id is NULL there is no
      // way left to work out whose claim it was.
      const releasing = await tx.stakeholder.findMany({ where, select: { id: true } });
      if (releasing.length === 0) return { count: 0 };

      const updated = await tx.stakeholder.updateMany({
        where,
        data: { assignedToId: null, assignedAt: null },
      });

      await recordRevocations(
        releasing.map(s => ({ stakeholderId: s.id, enumeratorId })),
        districts ? `claims released in ${districts.join(', ')}` : 'claims released',
        tx,
      );

      return updated;
    },
    { timeout: 120_000, maxWait: 30_000 },
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

  // Atomic for the same reason as releaseClaims: a release without its revocation
  // strands the rows on the device that held them.
  const result = await prisma.$transaction(
    async (tx) => {
      // Captured before the update — the ownership this revocation refers to is
      // about to be erased.
      const releasing = await tx.stakeholder.findMany({ where, select: { id: true } });
      if (releasing.length === 0) return { count: 0 };

      const updated = await tx.stakeholder.updateMany({
        where,
        data: { assignedToId: null, assignedAt: null },
      });

      await recordRevocations(
        releasing.map(s => ({ stakeholderId: s.id, enumeratorId })),
        'district no longer assigned',
        tx,
      );

      return updated;
    },
    { timeout: 120_000, maxWait: 30_000 },
  );

  if (result.count > 0) {
    logger.info(
      `[assignment] released ${result.count} out-of-district claim(s) from enumerator ${enumeratorId}`
    );
  }
  return result.count;
}

export interface RebalanceResult {
  /** Rows taken back from enumerators holding above the new fair share. */
  released: number;
  /** Rows handed straight out to enumerators holding below it. */
  redistributed: number;
  /** Per-enumerator outcome, for the audit log and the admin response. */
  assignments: Array<{ district: string; enumeratorId: string; share: number; before: number; after: number }>;
}

/**
 * Re-level a set of districts so every enumerator in them holds an equal share.
 *
 * WHEN THIS RUNS
 * Whenever a district's roster changes — an enumerator created with districts,
 * districts reassigned, an account deleted or deactivated — and on demand from the
 * admin endpoint. The roster is the divisor in the share calculation, so any change
 * to it silently invalidates every share already handed out.
 *
 * WHY IT BOTH TAKES AND GIVES
 * Releasing the overage alone is not enough. It only refills the pool, and a row in
 * the pool belongs to nobody until some device happens to call the claim endpoint.
 * A newly added enumerator would show an empty queue until their own phone next
 * synced — and if the admin added them precisely because the district needed
 * coverage, that is the moment the work should already be waiting. So this hands the
 * freed rows straight out, and the split is equal the instant the roster changes.
 *
 * ORDER OF OPERATIONS MATTERS
 * Take back first, then give out. Reversed, the emptiest enumerator would try to
 * claim from a pool that is still empty because the overage has not been returned to
 * it yet, and come away with nothing.
 *
 * FILL ORDER
 * Emptiest first. If the pool cannot satisfy everybody — a district whose rows are
 * mostly pinned by surveys in progress — the shortfall lands on whoever already has
 * the most to be getting on with.
 *
 * The district advisory lock is the same one the claim path takes, in the same
 * order, so a rebalance and a device syncing cannot interleave and act on stale
 * counts, and neither can deadlock against the other.
 */
export async function rebalanceDistricts(districts: string[]): Promise<RebalanceResult> {
  const canonical = await canonicalizeDistricts(districts);
  const result: RebalanceResult = { released: 0, redistributed: 0, assignments: [] };
  if (canonical.length === 0) return result;

  // PASS 1 — global ceiling, BEFORE the per-district work.
  //
  // Order is deliberate. The per-district pass tops people up to `share` but stops
  // at `WORK_QUOTA - heldTotal`, so if anyone is already over the ceiling that room
  // reads as zero or negative and they are skipped — leaving them over the ceiling
  // and the pool short of the rows they should have handed back. Trimming first
  // returns those rows to the pool in time for the same call to redistribute them.
  const roster = await prisma.enumeratorDistrict.findMany({
    where: {
      district: { name: { in: canonical } },
      enumerator: { isActive: true, isAdmin: false },
    },
    select: { enumeratorId: true, enumerator: { select: { districts: { select: { district: { select: { name: true } } } } } } },
  });

  for (const member of [...new Set(roster.map(r => r.enumeratorId))].sort()) {
    const memberDistricts = [
      ...new Set(
        roster
          .filter(r => r.enumeratorId === member)
          .flatMap(r => r.enumerator.districts.map(d => d.district?.name))
          .filter(Boolean) as string[]
      ),
    ].sort();

    result.released += await prisma.$transaction(
      async (tx) => {
        // Same lock order as the claim path — enumerator, then districts by name —
        // so a trim and a device syncing can never hold what the other needs.
        // The trim reaches across ALL of this enumerator's districts, not just the
        // ones being rebalanced, so every one of them is locked.
        await tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(${LOCK_NS_ENUMERATOR}::int, hashtext(${member}))`
        );
        for (const d of memberDistricts) {
          await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(${LOCK_NS_DISTRICT}::int, hashtext(${d}))`
          );
        }
        return trimToGlobalQuota(member, tx);
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  }

  // PASS 2 — per district: trim to the district share, then hand out what is free.
  for (const district of [...canonical].sort()) {
    const outcome = await prisma.$transaction(
      async (tx) => levelDistrictWithin(tx, district),
      { timeout: 120_000, maxWait: 30_000 },
    );

    result.released += outcome.released;
    result.redistributed += outcome.redistributed;
    result.assignments.push(...outcome.assignments);
  }

  return result;
}

async function levelDistrictWithin(tx: Db, district: string): Promise<RebalanceResult> {
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${LOCK_NS_DISTRICT}::int, hashtext(${district}))`
  );

  const released = await releaseOverShare(district, tx);

  // Recomputed after the claw-back, so openTotal and the roster reflect it.
  const openTotal = await tx.stakeholder.count({ where: { district, status: 'OPEN' } });
  const roster = await tx.enumeratorDistrict.findMany({
    where: { district: { name: district }, enumerator: { isActive: true, isAdmin: false } },
    select: { enumeratorId: true },
  });

  if (roster.length === 0 || openTotal === 0) {
    return { released, redistributed: 0, assignments: [] };
  }

  const share = Math.min(WORK_QUOTA, Math.ceil(openTotal / roster.length));

  // Two numbers per enumerator, and they are not the same thing:
  //   heldHere   what they hold in THIS district, measured against the share
  //   heldTotal  what they hold everywhere, measured against WORK_QUOTA
  // Ignoring the second would let someone covering three districts be topped up to
  // a full share in each and end up with 15 000 records on one phone.
  const holders: Array<{ enumeratorId: string; heldHere: number; heldTotal: number }> = [];
  for (const r of roster) {
    holders.push({
      enumeratorId: r.enumeratorId,
      heldHere: await tx.stakeholder.count({
        where: { district, assignedToId: r.enumeratorId, status: 'OPEN' },
      }),
      heldTotal: await tx.stakeholder.count({
        where: { assignedToId: r.enumeratorId, status: 'OPEN' },
      }),
    });
  }

  holders.sort((a, b) => a.heldHere - b.heldHere);

  let redistributed = 0;
  const assignments: RebalanceResult['assignments'] = [];

  for (const h of holders) {
    const want = Math.min(share - h.heldHere, WORK_QUOTA - h.heldTotal);
    const got = want > 0 ? await claimFromPool(tx, h.enumeratorId, district, want) : 0;

    redistributed += got;
    assignments.push({
      district,
      enumeratorId: h.enumeratorId,
      share,
      before: h.heldHere,
      after: h.heldHere + got,
    });

    if (got > 0) {
      logger.info(
        `[assignment] rebalance gave ${got} row(s) in ${district} to ${h.enumeratorId} ` +
        `(held ${h.heldHere} -> ${h.heldHere + got} of share ${share})`
      );
    }
  }

  if (released > 0 || redistributed > 0) {
    logger.info(
      `[assignment] rebalanced ${district}: reclaimed ${released}, handed out ${redistributed}, ` +
      `share ${share} across ${roster.length} enumerator(s) of ${openTotal} open`
    );
  }

  return { released, redistributed, assignments };
}
