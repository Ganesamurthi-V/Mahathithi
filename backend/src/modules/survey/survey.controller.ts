import { Response, NextFunction } from 'express';
import { SurveyService } from './survey.service';
import { AuthenticatedRequest } from '../../middleware/auth';
import { createSurveySchema } from '../../schemas/request-schemas';

const surveyService = new SurveyService();

export class SurveyController {
  async createOrUpdate(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // M5 FIX: validate + enforce length limits on every free-text field
      const { stakeholderId, ...surveyData } = createSurveySchema.parse(req.body);

      // C2 FIX: pass the caller's districts and admin flag for district enforcement
      const survey = await surveyService.createOrUpdate(
        { stakeholderId, enumeratorId: req.enumerator!.id, ...surveyData },
        req.enumerator!.districts,
        req.enumerator!.isAdmin
      );

      res.json({ success: true, data: survey });
    } catch (error) {
      next(error);
    }
  }

  async getByStakeholder(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // C2 FIX: pass districts and isAdmin so service can enforce district access
      // B2 FIX: pass the caller's id so they only get their own survey
      const survey = await surveyService.getByStakeholderId(
        req.params.stakeholderId as string,
        req.enumerator!.id,
        req.enumerator!.districts,
        req.enumerator!.isAdmin
      );
      res.json({ success: true, data: survey });
    } catch (error) {
      next(error);
    }
  }

  async complete(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // B1 FIX: pass districts and isAdmin so completion enforces district access
      const result = await surveyService.completeSurvey(
        (req.params.id as string),
        req.enumerator!.id,
        req.enumerator!.districts,
        req.enumerator!.isAdmin
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // B8 FIX: corrected method name typo (was getMysSurveys)
  async getMySurveys(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const surveys = await surveyService.getByEnumerator(req.enumerator!.id);
      res.json({ success: true, data: surveys });
    } catch (error) {
      next(error);
    }
  }
}
