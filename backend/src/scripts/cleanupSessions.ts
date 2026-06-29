/**
 * L5 FIX: Periodic cleanup of expired and invalidated sessions.
 *
 * Sessions accumulate indefinitely because nothing ever DELETEs rows where
 * `expires_at < NOW()` or `is_valid = false`. Over time this bloats the table,
 * slows down auth lookups, and leaves stale refresh-token hashes on disk.
 *
 * This script can be run:
 *   - As a daily cron job:  0 2 * * * node dist/scripts/cleanupSessions.js
 *   - Via npm script:       npm run db:cleanup-sessions
 *   - Manually:             npx tsx src/scripts/cleanupSessions.ts
 *
 * For Railway deployments, add it as a "Cron Service" pointing to this file.
 */

import { prisma } from '../config/database';
import { logger } from '../utils/logger';

async function cleanupSessions(): Promise<void> {
  const now = new Date();

  logger.info('[cleanup] Starting session cleanup...');

  // 1. Delete sessions that have passed their expiry timestamp
  const expiredResult = await prisma.session.deleteMany({
    where: {
      expiresAt: { lt: now },
    },
  });
  logger.info(`[cleanup] Deleted ${expiredResult.count} expired session(s)`);

  // 2. Delete sessions that were explicitly invalidated (logout, rotation)
  //    Keep a 24h grace period so we can still audit recent logouts if needed.
  const invalidatedCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const invalidatedResult = await prisma.session.deleteMany({
    where: {
      isValid: false,
      updatedAt: { lt: invalidatedCutoff },
    },
  });
  logger.info(`[cleanup] Deleted ${invalidatedResult.count} invalidated session(s)`);

  const total = expiredResult.count + invalidatedResult.count;
  logger.info(`[cleanup] Session cleanup complete. Total removed: ${total}`);
}

cleanupSessions()
  .catch((err) => {
    logger.error('[cleanup] Session cleanup failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
