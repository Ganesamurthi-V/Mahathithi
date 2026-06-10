import { Response, NextFunction } from 'express';
import { SurveyService } from './survey.service';
import { AuthenticatedRequest } from '../../middleware/auth';
import { ValidationError } from '../../utils/errors';

const surveyService = new SurveyService();

export class SurveyController {
  async createOrUpdate(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { stakeholderId, ...surveyData } = req.body;

      if (!stakeholderId) {
        throw new ValidationError('Stakeholder ID is required');
      }

      const survey = await surveyService.createOrUpdate({
        stakeholderId,
        enumeratorId: req.enumerator!.id,
        ...surveyData,
      });

      res.json({ success: true, data: survey });
    } catch (error) {
      next(error);
    }
  }

  async getByStakeholder(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const survey = await surveyService.getByStakeholderId((req.params.stakeholderId as string));
      res.json({ success: true, data: survey });
    } catch (error) {
      next(error);
    }
  }

  async complete(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await surveyService.completeSurvey(
        (req.params.id as string),
        req.enumerator!.id
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getMysSurveys(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const surveys = await surveyService.getByEnumerator(req.enumerator!.id);
      res.json({ success: true, data: surveys });
    } catch (error) {
      next(error);
    }
  }
}
