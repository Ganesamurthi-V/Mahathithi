import { Router } from 'express';
import { AuthController } from './auth.controller';
import { loginLimiter } from '../../middleware/rate-limiter';
import { authMiddleware } from '../../middleware/auth';

const router = Router();
const controller = new AuthController();

// Public routes
router.post('/login', loginLimiter, controller.login);
router.post('/refresh', controller.refreshToken);

// Protected routes
router.post('/logout', authMiddleware, controller.logout);
router.get('/me', authMiddleware, controller.getProfile);

export default router;
