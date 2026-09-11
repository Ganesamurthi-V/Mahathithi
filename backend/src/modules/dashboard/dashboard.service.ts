import { prisma } from '../../config/database';
import { districtScopeFilter } from '../../utils/district-scope';
import {
  getDistrictPartitions,
  isPartitioned,
  countPartitionedByStatus,
} from '../../utils/stakeholder-partition';

export class DashboardService {
  async getStats(enumeratorId: string, districts: string[], isAdmin: boolean) {
    // PERF: exact match on canonicalised district names. `mode: 'insensitive'`
    // forced LOWER(district) into the SQL, which defeated every index on the
    // column and made this groupBy a full scan of 295K rows (~1.1s).
    const districtFilter = isAdmin
      ? {}
      : await districtScopeFilter(districts);

    // The stakeholder download divides a shared district between its enumerators,
    // so "open" has to mean the caller's own share. It counted the whole district
    // before, which with three enumerators showed a task list three times larger
    // than the rows the device had actually downloaded — the operator would work
    // through their list and be left with a number that never reached zero.
    //
    // Admins get the identity partition (total=1, index=0), so their figures are
    // unchanged and still cover everything.
    const partitions = await getDistrictPartitions(enumeratorId, districts, isAdmin);

    // M4 FIX: scope sync counts to the calling enumerator for non-admins.
    // Previously every enumerator's dashboard showed the system-wide backlog
    // count — an information leak inconsistent with the district-scoping applied
    // to everything else on the same endpoint.
    const syncFilter = isAdmin
      ? {}
      : { enumeratorId }; // scope to this enumerator's own queue items

    // PERF: one groupBy replaces the separate OPEN + total stakeholder counts
    // (open = the OPEN bucket, total = sum of all buckets), and every remaining
    // count runs in a single Promise.all — the trailing `mySurveys` count used to
    // run sequentially after the others. `completed` keeps its own count because
    // it carries the extra lockedById filter that the status groupBy can't express.
    // Only reach for the raw partitioned count when a district is genuinely shared.
    // Prisma cannot express the modulo, but an unshared district does not need it —
    // and the Prisma groupBy is the version whose plan is already understood.
    const split = isPartitioned(partitions);

    const [statusCounts, completed, pendingSync, failedSync, mySurveys] = await Promise.all([
      split
        ? countPartitionedByStatus(partitions)
        : prisma.stakeholder
            .groupBy({
              by: ['status'],
              where: districtFilter,
              _count: { _all: true },
            })
            .then(groups =>
              // Normalised to the same shape countPartitionedByStatus returns, so
              // the two branches are interchangeable below.
              Object.fromEntries(groups.map(g => [String(g.status), g._count._all])),
            ),
      // Deliberately NOT partitioned. This is work the caller finished — they hold
      // the lock on it — and it stays theirs even if the slice boundaries move
      // afterwards because an enumerator was added to or removed from the district.
      prisma.stakeholder.count({
        where: { ...districtFilter, status: 'CLOSED' as any, lockedById: enumeratorId },
      }),
      prisma.syncQueue.count({ where: { ...syncFilter, status: 'PENDING' } }),
      prisma.syncQueue.count({ where: { ...syncFilter, status: 'FAILED' } }),
      prisma.survey.count({ where: { enumeratorId } }),
    ]);

    const open = statusCounts['OPEN'] ?? 0;
    const total = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);

    return {
      stakeholders: {
        completed,
        open,
        total,
      },
      sync: {
        pendingUploads: pendingSync,
        failedUploads: failedSync,
      },
      mySurveys,
      // Echoed so a device can tell whether it is seeing a share or a whole
      // district, and so "why is my open count lower than my colleague's" has an
      // answer in the response rather than only in server logs.
      partitions,
    };
  }
}

