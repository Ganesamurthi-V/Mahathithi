import { prisma } from '../config/database';
import { logger } from './logger';

type Db = Pick<typeof prisma, 'survey' | 'auditLog'>;

/**
 * Raise a survey for an admin to look at, keeping every reason it was raised for.
 *
 * Reasons accumulate rather than overwrite: a survey can be both far from the
 * business and have arrived after someone else completed the record, and the admin
 * should see both. The same reason is not added twice, so a phone retrying an upload
 * does not grow the text.
 */
export async function flagForReview(
  surveyId: string,
  reason: string,
  enumeratorId: string | null,
  db: Db = prisma,
): Promise<void> {
  const current = await db.survey.findUnique({
    where: { id: surveyId },
    select: { reviewReason: true, needsReview: true, stakeholderId: true },
  });
  if (!current) return;

  const reasons = (current.reviewReason ?? '').split(' | ').filter(Boolean);
  if (current.needsReview && reasons.includes(reason)) return;
  if (!reasons.includes(reason)) reasons.push(reason);

  await db.survey.update({
    where: { id: surveyId },
    data: { needsReview: true, reviewReason: reasons.join(' | ') },
  });

  await db.auditLog.create({
    data: {
      action: 'survey_flagged_for_review',
      entityType: 'survey',
      entityId: surveyId,
      enumeratorId,
      details: { stakeholderId: current.stakeholderId, reason },
    },
  });

  logger.warn(`[review] survey ${surveyId} flagged: ${reason}`);
}
