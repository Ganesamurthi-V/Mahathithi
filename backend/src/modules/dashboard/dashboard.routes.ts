import { Router } from 'express';
import { DashboardController } from './dashboard.controller';
import { authMiddleware } from '../../middleware/auth';

const router = Router();
const controller = new DashboardController();

router.use(authMiddleware);
router.get('/stats', controller.getStats);

export default router;
