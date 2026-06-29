import { prisma } from '../../config/database';

export class DashboardService {
  async getStats(enumeratorId: string, districts: string[], isAdmin: boolean) {
    const districtFilter = isAdmin
      ? {}
      : { district: { in: districts, mode: 'insensitive' as const } };

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
    const [statusGroups, completed, pendingSync, failedSync, mySurveys] = await Promise.all([
      prisma.stakeholder.groupBy({
        by: ['status'],
        where: districtFilter,
        _count: { _all: true },
      }),
      prisma.stakeholder.count({
        where: { ...districtFilter, status: 'CLOSED' as any, lockedById: enumeratorId },
      }),
      prisma.syncQueue.count({ where: { ...syncFilter, status: 'PENDING' } }),
      prisma.syncQueue.count({ where: { ...syncFilter, status: 'FAILED' } }),
      prisma.survey.count({ where: { enumeratorId } }),
    ]);

    const open = statusGroups.find((g) => g.status === ('OPEN' as any))?._count._all ?? 0;
    const total = statusGroups.reduce((sum, g) => sum + g._count._all, 0);

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
    };
  }
}

