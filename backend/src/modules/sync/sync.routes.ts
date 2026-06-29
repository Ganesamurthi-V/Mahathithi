import { Router } from 'express';
import express from 'express';
import { SyncController } from './sync.controller';
import { authMiddleware } from '../../middleware/auth';

const router = Router();
const controller = new SyncController();

router.use(authMiddleware);

// M1 FIX: the 25MB limit here overrides the global 1MB limit just for this
// route, which is the only one that needs to handle large batch payloads.
router.post('/upload', express.json({ limit: '25mb' }), controller.upload);
router.get('/changes', controller.getChanges);

export default router;

