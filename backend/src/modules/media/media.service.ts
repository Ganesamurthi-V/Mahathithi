import { prisma } from '../../config/database';
import { uploadToS3, getPresignedUrl, deleteFromS3, generateS3Key } from '../../config/storage';
import { NotFoundError, ForbiddenError, ConflictError } from '../../utils/errors';
import { assertStakeholderAccess } from '../../utils/access-control';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

interface UploadMediaData {
  enumeratorId: string;
  surveyId: string;
  type: 'PHOTO' | 'VIDEO';
  photoCategory?: string;
  fileName: string;
  fileBuffer: Buffer;
  mimeType: string;
  fileSize: number;
  latitude?: number;
  longitude?: number;
  gpsAccuracy?: number;
  duration?: number;
  localId?: string;
}

export class MediaService {
  // C3 FIX: accept districts and isAdmin so we can enforce ownership/district access
  async upload(data: UploadMediaData, callerDistricts: string[], isAdmin: boolean) {
    const survey = await prisma.survey.findUnique({
      where: { id: data.surveyId },
    });

    let resolvedSurveyId = data.surveyId;
    if (!survey) {
      const stakeholderId = data.surveyId.startsWith('draft_')
        ? data.surveyId.replace('draft_', '')
        : null;
      if (stakeholderId) {
        const existingSurvey = await prisma.survey.findFirst({
          where: { stakeholderId },
          orderBy: { updatedAt: 'desc' },
        });
        if (existingSurvey) {
          resolvedSurveyId = existingSurvey.id;
        } else {
          // C4 FIX: before auto-creating a draft survey, verify the caller
          // is actually assigned to this stakeholder's district and the
          // stakeholder is not already locked by someone else.
          const stakeholder = await prisma.stakeholder.findUnique({ where: { id: stakeholderId } });
          if (!stakeholder) throw new NotFoundError('Stakeholder');
          assertStakeholderAccess(stakeholder, callerDistricts, isAdmin);
          if (stakeholder.lockedById && stakeholder.lockedById !== data.enumeratorId) {
            throw new ConflictError('This stakeholder has been completed by another enumerator');
          }
          const newSurvey = await prisma.survey.create({
            data: {
              stakeholderId,
              enumeratorId: data.enumeratorId,
              isDraft: true,
              isSynced: true,
            },
          });
          resolvedSurveyId = newSurvey.id;
        }
      } else {
        throw new NotFoundError('Survey');
      }
    } else {
      // C3 FIX: verify the caller owns the existing survey before attaching media
      if (!isAdmin && survey.enumeratorId !== data.enumeratorId) {
        throw new ForbiddenError('You do not have access to this survey');
      }
    }

    if (data.type === 'PHOTO') {
      const existingPhotos = await prisma.media.count({
        where: { surveyId: resolvedSurveyId, type: 'PHOTO', deletedAt: null },
      });
      if (existingPhotos >= 50) {
        throw new Error('Maximum 50 photos allowed per survey');
      }
    }

    if (data.type === 'VIDEO') {
      const existingVideos = await prisma.media.count({
        where: { surveyId: resolvedSurveyId, type: 'VIDEO', deletedAt: null },
      });
      if (existingVideos >= 10) {
        throw new Error('Maximum 10 videos allowed per survey');
      }
    }

    // H5 FIX: generate a UUID-based filename for the S3 key so client-supplied
    // names (../path, unicode tricks, etc.) never end up in storage paths.
    // Keep the original name in the DB only as display metadata.
    const ext = path.extname(data.fileName).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const safeStorageName = `${uuidv4()}${ext}`;

    const s3Key = generateS3Key(
      data.type === 'PHOTO' ? 'photo' : 'video',
      resolvedSurveyId,
      safeStorageName // H5 FIX: use the safe server-generated name, not the client's
    );

    await uploadToS3(s3Key, data.fileBuffer, data.mimeType, {
      surveyId: resolvedSurveyId,
      type: data.type,
      ...(data.latitude ? { latitude: data.latitude.toString() } : {}),
      ...(data.longitude ? { longitude: data.longitude.toString() } : {}),
    });

    const fileUrl = await getPresignedUrl(s3Key);

    const media = await prisma.media.create({
      data: {
        surveyId: resolvedSurveyId,
        type: data.type,
        photoCategory: data.photoCategory as any,
        filePath: s3Key,
        fileUrl,
        fileName: data.fileName, // original name kept for display only
        fileSize: data.fileSize,
        mimeType: data.mimeType,
        latitude: data.latitude,
        longitude: data.longitude,
        gpsAccuracy: data.gpsAccuracy,
        capturedAt: new Date(),
        duration: data.duration,
        isSynced: true,
        localId: data.localId,
      },
    });

    logger.info(`Media uploaded: ${data.type} for survey ${data.surveyId}`);

    return media;
  }

  // C3 FIX: enforce district access before serving presigned S3 URLs
  async getBySurvey(surveyId: string, enumeratorId: string, callerDistricts: string[], isAdmin: boolean) {
    const survey = await prisma.survey.findUnique({
      where: { id: surveyId },
      include: { stakeholder: true },
    });
    if (!survey) throw new NotFoundError('Survey');

    if (!isAdmin) {
      const inDistrict = callerDistricts.some(
        (d) => d.toUpperCase() === survey.stakeholder?.district?.toUpperCase()
      );
      if (!inDistrict) throw new ForbiddenError('Not assigned to this district');
    }

    // L6/N2 FIX: never surface soft-deleted (tombstoned) media in listings
    const media = await prisma.media.findMany({
      where: { surveyId, deletedAt: null },
      orderBy: { capturedAt: 'asc' },
    });

    for (const item of media) {
      item.fileUrl = await getPresignedUrl(item.filePath);
    }

    return media;
  }

  // C3 FIX: verify the caller owns the media record before deleting
  async delete(mediaId: string, enumeratorId: string, isAdmin: boolean) {
    const media = await prisma.media.findUnique({
      where: { id: mediaId },
      include: { survey: true },
    });
    if (!media) throw new NotFoundError('Media');

    if (!isAdmin && media.survey.enumeratorId !== enumeratorId) {
      throw new ForbiddenError('You do not have access to this media');
    }

    // L6 FIX: soft-delete in DB FIRST so we always have a record to clean up.
    // The old order (S3 delete → DB delete) had two failure modes:
    //   1. S3 succeeds but DB fails → the DB still references a file that's gone
    //   2. S3 fails → no data loss, but the error was bubbled up before we even
    //      touched the DB, so the media row remained in a valid state
    //
    // New pattern:
    //   1. Mark deletedAt in DB (soft-delete) — this removes it from all queries
    //      that filter on deletedAt IS NULL (add that filter to getBySurvey if needed)
    //   2. Attempt S3 delete — if this fails, the soft-deleted row acts as a
    //      tombstone that a background garbage-collection job can pick up later
    //   (A full hard-delete of the DB row is done after S3 succeeds)
    await prisma.media.update({
      where: { id: mediaId },
      data: { deletedAt: new Date() },
    }).catch(() => {
      // If the soft-delete itself fails (e.g. DB down), abort before touching S3
      throw new Error('Failed to mark media for deletion — S3 object untouched');
    });

    try {
      await deleteFromS3(media.filePath);
      // S3 delete succeeded → safe to hard-delete the DB row now
      await prisma.media.delete({ where: { id: mediaId } });
    } catch (s3Error) {
      // S3 delete failed. The soft-deleted DB row acts as a tombstone.
      // A scheduled cleanup job can retry: SELECT * FROM media WHERE deleted_at IS NOT NULL
      logger.error(`S3 delete failed for media ${mediaId} (path: ${media.filePath}). Tombstone left in DB for retry.`, s3Error);
      // Re-throw so the caller gets a 500, but data is not lost
      throw s3Error;
    }

    logger.info(`Media deleted: ${mediaId}`);
  }
}

