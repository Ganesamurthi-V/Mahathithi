import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { broadcastChange } from '../realtime/events';
import { releaseIdleClaims, IDLE_RELEASE_DAYS } from '../utils/stakeholder-assignment';

const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000;

/**
 * Return idle enumerators' untouched records to the pool and tell the admins.
 *
 * The alert is an audit-log entry (action `idle_claims_released`, with the enumerator,
 * how many records came back, per district, and when they were last active) plus a
 * live refresh, so an admin with the Audit Logs page open sees it arrive.
 */
export async function runIdleClaimsSweep(): Promise<number> {
  const released = await releaseIdleClaims();
  if (released.length === 0) return 0;

  for (const r of released) {
    await prisma.auditLog.create({
      data: {
        action: 'idle_claims_released',
        entityType: 'enumerator',
        entityId: r.enumeratorId,
        details: {
          enumerator: r.name,
          loginId: r.loginId,
          idleDays: IDLE_RELEASE_DAYS,
          lastActiveAt: r.lastActiveAt ? r.lastActiveAt.toISOString() : null,
          releasedRecords: r.released,
          keptWithStartedSurvey: r.kept,
          releasedByDistrict: r.districts,
        },
      },
    });
  }

  broadcastChange(['auditLogs', 'stakeholders', 'analytics', 'enumerators'], { action: 'update' });
  return released.reduce((n, r) => n + r.released, 0);
}

/**
 * Runs the sweep shortly after boot and every few hours after. Safe on several
 * server instances at once: the release only matches rows still assigned, so a
 * second run finds nothing to do and writes no alert.
 */
export function startIdleClaimsJob(): void {
  const run = () => {
    runIdleClaimsSweep()
      .then((n) => {
        if (n > 0) logger.warn(`[idle-claims] returned ${n} record(s) from idle enumerators to the pool`);
      })
      .catch((err) => logger.error('[idle-claims] sweep failed:', err));
  };

  setTimeout(run, FIRST_SWEEP_DELAY_MS).unref();
  setInterval(run, SWEEP_EVERY_MS).unref();
}
