import { Router } from 'express';
import { StakeholderController } from './stakeholder.controller';
import { authMiddleware } from '../../middleware/auth';
import { districtGuard } from '../../middleware/district-guard';

const router = Router();
const controller = new StakeholderController();

// All routes require authentication
router.use(authMiddleware);

router.get('/search', controller.search);
router.get('/assigned', controller.getAssigned);
router.get('/:id', districtGuard, controller.getById);
router.patch('/:id/lock', districtGuard, controller.lock);
router.patch('/:id/status', districtGuard, controller.updateStatus);

export default router;
