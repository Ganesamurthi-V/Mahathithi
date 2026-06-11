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

    // Get sync stats
    const [pendingSync, failedSync] = await Promise.all([
      prisma.syncQueue.count({ where: { status: 'PENDING' } }),
      prisma.syncQueue.count({ where: { status: 'FAILED' } }),
    ]);

    // My surveys count
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
