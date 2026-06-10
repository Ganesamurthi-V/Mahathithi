import { Response, NextFunction } from 'express';
import { MediaService } from './media.service';
import { AuthenticatedRequest } from '../../middleware/auth';
import { ValidationError } from '../../utils/errors';

const mediaService = new MediaService();

export class MediaController {
  async upload(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        throw new ValidationError('No file provided');
      }

      const { surveyId, type, photoCategory, latitude, longitude, gpsAccuracy, duration, localId } = req.body;

      if (!surveyId || !type) {
        throw new ValidationError('Survey ID and type are required');
      }

      const media = await mediaService.upload({
        surveyId,
        type: type as 'PHOTO' | 'VIDEO',
        photoCategory,
        fileName: file.originalname,
        fileBuffer: file.buffer,
        mimeType: file.mimetype,
        fileSize: file.size,
        latitude: latitude ? parseFloat(latitude) : undefined,
        longitude: longitude ? parseFloat(longitude) : undefined,
        gpsAccuracy: gpsAccuracy ? parseFloat(gpsAccuracy) : undefined,
        duration: duration ? parseInt(duration, 10) : undefined,
        localId,
      });

      res.json({ success: true, data: media });
    } catch (error) {
      next(error);
    }
  }

  async getBySurvey(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const media = await mediaService.getBySurvey((req.params.surveyId as string));
      res.json({ success: true, data: media });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await mediaService.delete((req.params.id as string));
      res.json({ success: true, message: 'Media deleted' });
    } catch (error) {
      next(error);
    }
  }
}
