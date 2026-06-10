import { prisma } from '../../config/database';
import { uploadToS3, getPresignedUrl, deleteFromS3, generateS3Key } from '../../config/storage';
import { NotFoundError } from '../../utils/errors';
import { logger } from '../../utils/logger';

interface UploadMediaData {
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
    // Verify survey exists
    const survey = await prisma.survey.findUnique({
      where: { id: data.surveyId },
    });
    if (!survey) throw new NotFoundError('Survey');

    // Check photo limits (max 5)
    if (data.type === 'PHOTO') {
      const existingPhotos = await prisma.media.count({
        where: { surveyId: data.surveyId, type: 'PHOTO' },
      });
      if (existingPhotos >= 5) {
        throw new Error('Maximum 5 photos allowed per survey');
      }
    }

    // Check video limit (max 1)
    if (data.type === 'VIDEO') {
      const existingVideos = await prisma.media.count({
        where: { surveyId: data.surveyId, type: 'VIDEO' },
      });
      if (existingVideos >= 1) {
        throw new Error('Maximum 1 video allowed per survey');
      }
    }

    // Upload to S3
    const s3Key = generateS3Key(
      data.type === 'PHOTO' ? 'photo' : 'video',
      data.surveyId,
      data.fileName
    );

    await uploadToS3(s3Key, data.fileBuffer, data.mimeType, {
      surveyId: data.surveyId,
      type: data.type,
      ...(data.latitude ? { latitude: data.latitude.toString() } : {}),
      ...(data.longitude ? { longitude: data.longitude.toString() } : {}),
    });

    // Generate presigned URL
    const fileUrl = await getPresignedUrl(s3Key);

    // Store metadata in DB
    const media = await prisma.media.create({
      data: {
        surveyId: data.surveyId,
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
