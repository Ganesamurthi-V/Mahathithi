import { prisma } from '../../config/database';
import { uploadToS3, getPresignedUrl, deleteFromS3, generateS3Key } from '../../config/storage';
import { NotFoundError } from '../../utils/errors';
import { logger } from '../../utils/logger';

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
  async upload(data: UploadMediaData) {
    // Verify survey exists (soft check — allow upload even if survey hasn't synced yet)
    const survey = await prisma.survey.findUnique({
      where: { id: data.surveyId },
    });
    // If survey not found by ID, try finding by stakeholderId embedded in the surveyId
    // This handles 'draft_<stakeholderId>' pattern from offline-first mobile app
    let resolvedSurveyId = data.surveyId;
    if (!survey) {
      // Try to find any survey linked to this stakeholder
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
          // Survey not found on server. Auto-create a blank draft survey to attach media to.
          const newSurvey = await prisma.survey.create({
            data: {
              stakeholderId,
              enumeratorId: data.enumeratorId,
              isDraft: true,
              isSynced: true,
            }
          });
          resolvedSurveyId = newSurvey.id;
        }
      } else {
        throw new NotFoundError('Survey');
      }
    }

    // Check photo limits (relaxed for sync pipeline)
    if (data.type === 'PHOTO') {
      const existingPhotos = await prisma.media.count({
        where: { surveyId: resolvedSurveyId, type: 'PHOTO' },
      });
      if (existingPhotos >= 50) {
        throw new Error('Maximum 50 photos allowed per survey');
      }
    }

    // Check video limit (relaxed for sync pipeline)
    if (data.type === 'VIDEO') {
      const existingVideos = await prisma.media.count({
        where: { surveyId: resolvedSurveyId, type: 'VIDEO' },
      });
      if (existingVideos >= 10) {
        throw new Error('Maximum 10 videos allowed per survey');
      }
    }

    // Upload to S3
    const s3Key = generateS3Key(
      data.type === 'PHOTO' ? 'photo' : 'video',
      resolvedSurveyId,
      data.fileName
    );

    await uploadToS3(s3Key, data.fileBuffer, data.mimeType, {
      surveyId: resolvedSurveyId,
      type: data.type,
      ...(data.latitude ? { latitude: data.latitude.toString() } : {}),
      ...(data.longitude ? { longitude: data.longitude.toString() } : {}),
    });

    // Generate presigned URL
    const fileUrl = await getPresignedUrl(s3Key);

    // Store metadata in DB
    const media = await prisma.media.create({
      data: {
        surveyId: resolvedSurveyId,
        type: data.type,
        photoCategory: data.photoCategory as any,
        filePath: s3Key,
        fileUrl,
        fileName: data.fileName,
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

  async getBySurvey(surveyId: string) {
    const media = await prisma.media.findMany({
      where: { surveyId },
      orderBy: { capturedAt: 'asc' },
    });

    // Refresh presigned URLs
    for (const item of media) {
      item.fileUrl = await getPresignedUrl(item.filePath);
    }

    return media;
  }

  async delete(mediaId: string) {
    const media = await prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) throw new NotFoundError('Media');

    // Delete from S3
    await deleteFromS3(media.filePath);

    // Delete from DB
    await prisma.media.delete({ where: { id: mediaId } });

    logger.info(`Media deleted: ${mediaId}`);
  }
}
