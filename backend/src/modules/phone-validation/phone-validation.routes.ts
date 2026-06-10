import { Router } from 'express';
import { PhoneValidationController } from './phone-validation.controller';
import { authMiddleware } from '../../middleware/auth';

const router = Router();
const controller = new PhoneValidationController();

router.use(authMiddleware);

router.post('/', controller.create);
router.get('/stakeholder/:stakeholderId', controller.getByStakeholder);
router.patch('/:id', controller.update);

export default router;
