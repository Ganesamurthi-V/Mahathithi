import { Router } from 'express';
import { SurveyController } from './survey.controller';
import { authMiddleware } from '../../middleware/auth';

const router = Router();
const controller = new SurveyController();

router.use(authMiddleware);

router.post('/', controller.createOrUpdate);
router.get('/mine', controller.getMysSurveys);
router.get('/stakeholder/:stakeholderId', controller.getByStakeholder);
router.post('/:id/complete', controller.complete);

export default router;
