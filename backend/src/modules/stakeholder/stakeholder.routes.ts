import { Router } from 'express';
import { StakeholderController } from './stakeholder.controller';
import { authMiddleware, adminOnly } from '../../middleware/auth';
import { districtGuard } from '../../middleware/district-guard';

const router = Router();
const controller = new StakeholderController();

// All routes require authentication
router.use(authMiddleware);

router.get('/search', controller.search);
router.get('/assigned/paged', controller.getAssignedPaged); // paginated sync — safe for 1 L+ rows
router.get('/assigned', controller.getAssigned);            // legacy — kept for backward compat

// Create a stakeholder by hand (mobile + admin panel). Any authenticated user may
// create, but the service confines a non-admin to their assigned districts, so
// districtGuard is not used here: that middleware authorises an EXISTING record by
// :id, and there is no id yet.
router.post('/', controller.create);

router.get('/:id', districtGuard, controller.getById);
router.patch('/:id/lock', districtGuard, controller.lock);
// N3 FIX: status changes (OPEN/CLOSED) lock or reopen a record and bypass every
// survey-completion requirement, so this is an admin-only operation. Previously
// any in-district enumerator could force-close or reopen a stakeholder.
router.patch('/:id/status', adminOnly, controller.updateStatus);
router.patch('/:id', districtGuard, controller.updateStakeholder);

// Delete is admin-only and deliberately narrower than edit. It is a hard delete of
// an imported registry record, recoverable only from the audit snapshot the service
// writes, so it is not something a field enumerator should be able to do while
// working a list on a phone. districtGuard is still applied so an admin-scoped
// check stays consistent with the other :id routes.
router.delete('/:id', adminOnly, districtGuard, controller.remove);

export default router;
