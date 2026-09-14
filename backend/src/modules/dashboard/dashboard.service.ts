import { prisma } from '../../config/database';
import { districtScopeFilter } from '../../utils/district-scope';
import { WORK_QUOTA, getDistrictShares } from '../../utils/stakeholder-assignment';

export class DashboardService {
  async getStats(enumeratorId: string, districts: string[], isAdmin: boolean) {
    // PERF: exact match on canonicalised district names. `mode: 'insensitive'`
    // forced LOWER(district) into the SQL, which defeated every index on the
    // column and made this groupBy a full scan of 295K rows (~1.1s).
    const districtFilter = isAdmin
      ? {}
      : await districtScopeFilter(districts);

    // M4 FIX: scope sync counts to the calling enumerator for non-admins.
    // Previously every enumerator's dashboard showed the system-wide backlog
    // count — an information leak inconsistent with the district-scoping applied
    // to everything else on the same endpoint.
    const syncFilter = isAdmin
      ? {}
      : { enumeratorId }; // scope to this enumerator's own queue items

    // An enumerator's figures describe the work CLAIMED BY THEM, not the district.
    // Counting the district showed a task list several times larger than the rows
    // the device had actually downloaded, so the operator worked through everything
    // they were given and was left with a number that never reached zero.
    //
    // This used to be a raw-SQL count over a modulo slice. A stored claim is an
    // indexed column (assigned_to_id), so it is a plain Prisma count now — the
    // whole partitioned-count path and its hand-written SQL are gone.
    //
    // Admins hold no claims, so they keep the district-scoped view; scoping an
    // admin by assignment would report zero.
    const assignedFilter = isAdmin
      ? districtFilter
      : { assignedToId: enumeratorId };

    const [open, completed, pendingSync, failedSync, mySurveys, shares] = await Promise.all([
      prisma.stakeholder.count({
        where: { ...assignedFilter, status: 'OPEN' as any },
      }),
      // Deliberately keyed on lockedById, not the assignment. This is work the
      // caller finished — they hold the completion lock — and it stays theirs even
      // if the claim is later released back to the pool.
      prisma.stakeholder.count({
        where: { ...districtFilter, status: 'CLOSED' as any, lockedById: enumeratorId },
      }),
      prisma.syncQueue.count({ where: { ...syncFilter, status: 'PENDING' } }),
      prisma.syncQueue.count({ where: { ...syncFilter, status: 'FAILED' } }),
      prisma.survey.count({ where: { enumeratorId } }),
      // Per-district fair shares. Carries the unclaimed pool too, so a device can
      // tell "you are done" apart from "you finished this batch and more is
      // waiting" — identical from an empty local list otherwise.
      isAdmin ? Promise.resolve([]) : getDistrictShares(enumeratorId, districts),
    ]);

    return {
      stakeholders: {
        completed,
        open,
        // `total` used to be the district-wide row count. For an enumerator it now
        // means everything they hold, finished or not, which is the number that
        // matches what is on their device.
        total: open + completed,
      },
      sync: {
        pendingUploads: pendingSync,
        failedUploads: failedSync,
      },
      mySurveys,
      // Lets the mobile app decide whether to top up, and show "N more available"
      // rather than an unexplained empty list.
      assignment: {
        held: open,
        // The hard ceiling, and the fair-share target under it. Both are reported
        // because they answer different questions: `quota` is the most this device
        // will ever hold, `target` is what a full queue looks like right now. In a
        // shared district target is well below quota, and showing only quota would
        // make a correctly-filled queue read as a half-finished download.
        quota: WORK_QUOTA,
        target: Math.min(WORK_QUOTA, shares.reduce((n, s) => n + s.share, 0)),
        poolRemaining: shares.reduce((n, s) => n + s.pool, 0),
        canClaimMore:
          !isAdmin &&
          shares.some(s => s.held < s.share && s.pool > 0) &&
          open < WORK_QUOTA,
        shares,
      },
    };
  }
}
