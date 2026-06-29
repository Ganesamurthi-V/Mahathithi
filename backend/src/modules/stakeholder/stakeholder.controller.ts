import { Response, NextFunction } from 'express';
import { StakeholderService } from './stakeholder.service';
import { AuthenticatedRequest } from '../../middleware/auth';
import { ValidationError } from '../../utils/errors';
import { updateStakeholderSchema } from '../../schemas/request-schemas';

const stakeholderService = new StakeholderService();

export class StakeholderController {
  async search(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        name, org, state, district, pinCode, category,
        nicCode, gst, status, page = '1', limit = '20'
      } = req.query;

      const result = await stakeholderService.search({
        name: name as string,
        org: org as string,
        state: state as string,
        district: district as string,
        pinCode: pinCode as string,
        category: category as string,
        nicCode: nicCode as string,
        gst: gst as string,
        status: status as string,
        page: parseInt(page as string, 10) || 1,
        limit: Math.min(parseInt(limit as string, 10) || 20, 100),
        assignedDistricts: req.enumerator!.districts,
        isAdmin: req.enumerator!.isAdmin,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // X2 FIX: pass the caller's id so surveys/phone validations are scoped
      const stakeholder = await stakeholderService.getById(
        (req.params.id as string),
        req.enumerator!.id,
        req.enumerator!.districts,
        req.enumerator!.isAdmin
      );

      res.json({ success: true, data: stakeholder });
    } catch (error) {
      next(error);
    }
  }

  async getAssigned(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { since } = req.query;
      const stakeholders = await stakeholderService.getAssigned(
        req.enumerator!.id,
        req.enumerator!.districts,
        since as string
      );

      res.json({ success: true, data: { stakeholders, count: stakeholders.length } });
    } catch (error) {
      next(error);
    }
  }

  async lock(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await stakeholderService.lockStakeholder(
        (req.params.id as string),
        req.enumerator!.id
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateStatus(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status } = req.body;
      // H3 FIX: validate against the real Prisma enum — StakeholderStatus is OPEN/CLOSED,
      // NOT the old ['PENDING','IN_PROGRESS','IN_REVIEW','COMPLETED'] that made this
      // endpoint permanently broken (Prisma would throw a cast error on every call).
      const validStatuses = ['OPEN', 'CLOSED'];
      if (!status || !validStatuses.includes(status)) {
        throw new ValidationError(`Invalid status value. Must be one of: ${validStatuses.join(', ')}`);
      }

      const result = await stakeholderService.updateStatus(
        (req.params.id as string),
        status,
        req.enumerator!.id
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateStakeholder(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // M5 FIX: validate + enforce field length limits via Zod
      const validated = updateStakeholderSchema.parse(req.body);

      const result = await stakeholderService.updateStakeholder(
        (req.params.id as string),
        validated,
        req.enumerator!.id
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}
