import { Router } from 'express';
import { StakeholderController } from './stakeholder.controller';
import { authMiddleware, adminOnly } from '../../middleware/auth';
import { districtGuard } from '../../middleware/district-guard';

const router = Router();
const controller = new StakeholderController();

// All routes require authentication
router.use(authMiddleware);

router.get('/search', controller.search);
router.get('/assigned', controller.getAssigned);
router.get('/:id', districtGuard, controller.getById);
router.patch('/:id/lock', districtGuard, controller.lock);
// N3 FIX: status changes (OPEN/CLOSED) lock or reopen a record and bypass every
// survey-completion requirement, so this is an admin-only operation. Previously
// any in-district enumerator could force-close or reopen a stakeholder.
router.patch('/:id/status', adminOnly, controller.updateStatus);
router.patch('/:id', districtGuard, controller.updateStakeholder);

export default router;
