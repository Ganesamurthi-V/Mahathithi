import { Router } from 'express';
import { SyncController } from './sync.controller';
import { authMiddleware } from '../../middleware/auth';

const router = Router();
const controller = new SyncController();

router.use(authMiddleware);

router.post('/upload', controller.upload);
router.get('/changes', controller.getChanges);

export default router;
