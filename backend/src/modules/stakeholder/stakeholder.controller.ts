import { Response, NextFunction } from 'express';
import { StakeholderService } from './stakeholder.service';
import { AuthenticatedRequest } from '../../middleware/auth';
import { ValidationError } from '../../utils/errors';
import { updateStakeholderSchema, createStakeholderSchema } from '../../schemas/request-schemas';
import { claimStakeholders } from '../../utils/stakeholder-assignment';
import { broadcastChange } from '../../realtime/events';

const stakeholderService = new StakeholderService();

export class StakeholderController {
  async search(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        name, org, state, district, pinCode, category,
        nicCode, gst, status, digipin, page = '1', limit = '20'
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
        digipin: digipin as string,
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
        since as string,
        req.enumerator!.isAdmin
      );

      res.json({ success: true, data: { stakeholders, count: stakeholders.length } });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Paginated sync endpoint — safe for 1 L+ rows.
   *
   * Query params:
   *   after      – cursor (primaryKeyId of the last row received). Omit for first page.
   *   page_size  – rows per page (default 2 000, max 5 000).
   *   since      – ISO timestamp; when provided only rows updated after this time are returned.
   *
   * Response:
   *   { success, data: { stakeholders[], nextCursor, pageSize, count } }
   *   nextCursor is null when there are no more pages.
   */
  async getAssignedPaged(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { since, after, page_size } = req.query;
      const afterCursor = after ? parseInt(after as string, 10) : 0;
      const pageSize = page_size ? parseInt(page_size as string, 10) : 2000;

      const result = await stakeholderService.getAssignedPage(
        req.enumerator!.id,
        req.enumerator!.districts,
        isNaN(afterCursor) ? 0 : afterCursor,
        isNaN(pageSize) ? 2000 : pageSize,
        since as string,
        req.enumerator!.isAdmin,
      );

      res.json({ success: true, data: result });
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

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const validated = createStakeholderSchema.parse(req.body);

      const result = await stakeholderService.createStakeholder(validated, {
        id: req.enumerator!.id,
        districts: req.enumerator!.districts,
        isAdmin: req.enumerator!.isAdmin,
      });

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async remove(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await stakeholderService.deleteStakeholder(
        (req.params.id as string),
        req.enumerator!.id
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Top up the caller's work queue from the unassigned pool in their districts.
   *
   * Called by the mobile app before the initial download and again after a sync,
   * once completed surveys have freed room under the quota. Idempotent: with a full
   * queue or an empty pool it claims nothing and says so, so the client can call it
   * freely rather than having to track when it is due.
   */
  async claim(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // An admin has no work queue of their own — they see whole districts — so
      // letting them claim would take records away from the field for no reason.
      if (req.enumerator!.isAdmin) {
        throw new ValidationError(
          'Admins are not assigned survey work, so there is nothing to claim.'
        );
      }

      const result = await claimStakeholders(
        req.enumerator!.id,
        req.enumerator!.districts,
      );

      // Only announce when something actually moved. The pool shrinking changes the
      // district counts other clients display, and the claimed rows now carry a new
      // updated_at so the caller's own delta feed will deliver them.
      if (result.claimed > 0) {
        broadcastChange(['stakeholders', 'analytics'], { action: 'update' });
      }

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}
