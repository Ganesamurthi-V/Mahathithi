import { prisma } from '../../config/database';

export class DashboardService {
  async getStats(enumeratorId: string, districts: string[], isAdmin: boolean) {
    const districtFilter = isAdmin
      ? {}
      : { district: { in: districts, mode: 'insensitive' as const } };

    const [completed, open, total] = await Promise.all([
      prisma.stakeholder.count({
        where: { ...districtFilter, status: 'CLOSED' as any, lockedById: enumeratorId },
      }),
      prisma.stakeholder.count({
        where: { ...districtFilter, status: 'OPEN' as any },
      }),
      prisma.stakeholder.count({
        where: districtFilter,
      }),
    ]);

    // M4 FIX: scope sync counts to the calling enumerator for non-admins.
    // Previously every enumerator's dashboard showed the system-wide backlog
    // count — an information leak inconsistent with the district-scoping applied
    // to everything else on the same endpoint.
    const syncFilter = isAdmin
      ? {}
      : { enumeratorId }; // scope to this enumerator's own queue items

    const [pendingSync, failedSync] = await Promise.all([
      prisma.syncQueue.count({ where: { ...syncFilter, status: 'PENDING' } }),
      prisma.syncQueue.count({ where: { ...syncFilter, status: 'FAILED' } }),
    ]);

    const mySurveys = await prisma.survey.count({
      where: { enumeratorId },
    });

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

