import { Router } from 'express';
import { digipinController } from './digipin.controller';

const router = Router();

router.post('/encode', digipinController.encode);
router.post('/decode', digipinController.decode);

export default router;
