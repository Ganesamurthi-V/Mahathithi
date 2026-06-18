import { Router } from 'express';
import { syncOfflineFacilities } from './facilities.controller';
import { authMiddleware } from '../../middleware/auth';

const router = Router();

// Allow enumerators to sync facilities offline
router.get('/sync-offline', authMiddleware, syncOfflineFacilities);

export default router;
