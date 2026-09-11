import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { canonicalizeDistricts } from './district-scope';
import { logger } from './logger';

/**
 * Dividing a district's stakeholders between the enumerators assigned to it.
 *
 * Extracted from StakeholderService so the dashboard can report the SAME slice the
 * sync feed delivers. Duplicating this would be the worst kind of copy: the two
 * would agree at first and then drift, and the symptom would be a device showing a
 * task count it never received the rows for.
 *
 * WHY MODULO ON primaryKeyId
 * For district D with n assigned enumerators, the enumerator at index k owns the
 * rows where `primary_key_id % n = k`.
 *
 *   - It is a true partition: every row satisfies exactly one k, so there is no
 *     duplication AND no gap. That second property matters most — a scheme which
 *     only avoids overlap can still orphan records, and nothing would report it.
 *   - It is stateless and deterministic, so it holds across a paginated cursor loop
 *     with no server-side memory between requests.
 *   - Shares come out even because primaryKeyId is a dense counter from the import
 *     rather than a sparse or clustered key.
 *
 * A district with one enumerator gives n=1, k=0, and `% 1 = 0` matches every row, so
 * unshared districts behave exactly as they did before any of this existed.
 */
export interface DistrictPartition {
  district: string;
  /** How many enumerators share this district. 1 means unpartitioned. */
  total: number;
  /** This enumerator's slice index, 0-based. */
  index: number;
}

/**
 * Work out which slice of each district belongs to this enumerator.
 *
 * ORDERING
 * k is the enumerator's position in the member list sorted by id, sorted in code
 * rather than trusting the database's row order. An unordered result could hand the
 * same enumerator a different k on a later page and the download would then mix two
 * slices — duplicating some rows and missing others.
 *
 * WHO COUNTS TOWARD n
 *   - Inactive enumerators are excluded. A deactivated account holding a share means
 *     nobody downloads it, which is the gap this design exists to avoid.
 *   - Admins are excluded. They bypass district scoping and receive everything
 *     anyway, so counting them would reserve a share no device ever collects.
 */
export async function getDistrictPartitions(
  enumeratorId: string,
  districts: string[],
  isAdmin: boolean,
): Promise<DistrictPartition[]> {
  const canonical = await canonicalizeDistricts(districts);
  if (canonical.length === 0) return [];

  // Admins are not field devices; they get the whole of every district they ask
  // for. total=1/index=0 is the identity partition.
  if (isAdmin) {
    return canonical.map(district => ({ district, total: 1, index: 0 }));
  }

  const assignments = await prisma.enumeratorDistrict.findMany({
    where: {
      district: { name: { in: canonical } },
      enumerator: { isActive: true, isAdmin: false },
    },
    select: {
      enumeratorId: true,
      district: { select: { name: true } },
    },
  });

  const membersByDistrict = new Map<string, string[]>();
  for (const a of assignments) {
    const name = a.district?.name;
    if (!name) continue;
    const list = membersByDistrict.get(name);
    if (list) list.push(a.enumeratorId);
    else membersByDistrict.set(name, [a.enumeratorId]);
  }

  return canonical.map(district => {
    const members = (membersByDistrict.get(district) ?? []).slice().sort();
    const index = members.indexOf(enumeratorId);

    if (members.length <= 1) return { district, total: 1, index: 0 };

    if (index === -1) {
      // The caller is scoped to this district but is not in its active non-admin
      // membership — an inactive account, or an assignment removed mid-session.
      // Serve the whole district rather than nothing: an empty work queue looks
      // like data loss to the operator, whereas an extra copy of reference data is
      // harmless. Logged because it means the assignment data and the caller's
      // token disagree.
      logger.warn(
        `[partition] enumerator ${enumeratorId} is scoped to ${district} but not in its active membership (${members.length}); serving the full district`
      );
      return { district, total: 1, index: 0 };
    }

    return { district, total: members.length, index };
  });
}

/** True when at least one district is actually shared and needs the modulo filter. */
export function isPartitioned(partitions: DistrictPartition[]): boolean {
  return partitions.some(p => p.total > 1);
}

/**
 * SQL fragments matching the caller's slice of each district, OR-ed together.
 *
 * Every value is bound as a parameter through Prisma.sql, so district names and the
 * n/k pair cannot be injected even though the branch list is assembled dynamically.
 */
export function partitionSqlFilter(partitions: DistrictPartition[]): Prisma.Sql {
  const branches = partitions.map(p =>
    p.total <= 1
      // No modulo term when the district is not split, so Postgres can use the
      // district index without a residual expression filter.
      ? Prisma.sql`district = ${p.district}`
      : Prisma.sql`(district = ${p.district} AND (primary_key_id % ${p.total}) = ${p.index})`
  );
  return Prisma.join(branches, ' OR ');
}

/**
 * One page of primary keys from the caller's slice, ordered by primary key.
 *
 * Raw SQL because the modulo has no Prisma equivalent. Only the keys are selected —
 * the caller then loads full rows through Prisma, because the mobile mirror persists
 * ~37 scalar columns and a hand-written column list would drop one silently.
 */
export async function selectPartitionedPrimaryKeys(
  partitions: DistrictPartition[],
  after: number,
  since: string | undefined,
  limit: number,
): Promise<number[]> {
  // status is a Postgres enum, so the literal needs an explicit cast — an untyped
  // 'OPEN' string fails with "operator does not exist".
  const rows = await prisma.$queryRaw<{ primary_key_id: number }[]>(Prisma.sql`
    SELECT primary_key_id
    FROM stakeholders
    WHERE status = 'OPEN'::"StakeholderStatus"
      AND primary_key_id > ${after}
      ${since ? Prisma.sql`AND updated_at > ${new Date(since)}` : Prisma.empty}
      AND (${partitionSqlFilter(partitions)})
    ORDER BY primary_key_id ASC
    LIMIT ${limit}
  `);

  // Number() guards against a driver handing back a string or BigInt for the
  // integer column; the value is used as a cursor and compared numerically.
  return rows.map(r => Number(r.primary_key_id));
}

/**
 * Per-status counts for the caller's slice.
 *
 * Exists so the dashboard can report the work an enumerator was actually given.
 * It previously counted the whole district, which with three enumerators showed a
 * task list three times larger than the rows the device ever downloaded.
 *
 * One grouped query rather than one count per status, because this runs on every
 * dashboard open.
 */
export async function countPartitionedByStatus(
  partitions: DistrictPartition[],
): Promise<Record<string, number>> {
  if (partitions.length === 0) return {};

  const rows = await prisma.$queryRaw<{ status: string; count: bigint | number }[]>(Prisma.sql`
    SELECT status::text AS status, COUNT(*) AS count
    FROM stakeholders
    WHERE (${partitionSqlFilter(partitions)})
    GROUP BY status
  `);

  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = Number(r.count);
  return out;
}
