import { Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { AuthenticatedRequest } from '../../middleware/auth';
import { NotFoundError, ValidationError, ForbiddenError } from '../../utils/errors';
import { assertStakeholderAccess } from '../../utils/access-control';

const ALLOWED_STATUSES = ['PENDING_VERIFICATION', 'VERIFIED', 'FAILED'];

export class PhoneValidationController {
  async create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { stakeholderId, phoneNumber, status, method, remarks } = req.body;

      if (!stakeholderId || !phoneNumber) {
        throw new ValidationError('Stakeholder ID and phone number are required');
      }

      if (!ALLOWED_STATUSES.includes(status)) {
        throw new ValidationError('Invalid verification status');
      }

      const validation = await prisma.phoneValidation.create({
        data: {
          stakeholderId,
          enumeratorId: req.enumerator!.id,
          phoneNumber,
          status,
          method: method || 'phone_call',
          verifiedAt: status === 'VERIFIED' ? new Date() : null,
          remarks,
        },
      });

      await prisma.auditLog.create({
        data: {
          action: 'phone_verification',
          entityType: 'phone_validation',
          entityId: validation.id,
          enumeratorId: req.enumerator!.id,
          details: { stakeholderId, status, phoneNumber },
        },
      });

      res.json({ success: true, data: validation });
    } catch (error) {
      next(error);
    }
  }

  async getByStakeholder(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // C5 FIX: check district access before returning phone validation history
      const stakeholder = await prisma.stakeholder.findUnique({
        where: { id: req.params.stakeholderId as string },
      });
      if (!stakeholder) throw new NotFoundError('Stakeholder');
      assertStakeholderAccess(stakeholder, req.enumerator!.districts, req.enumerator!.isAdmin);

      const validations = await prisma.phoneValidation.findMany({
        where: { stakeholderId: req.params.stakeholderId as string },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: validations });
    } catch (error) {
      next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status, remarks } = req.body;

      // C5 FIX: validate the enum before touching the DB — previously any string
      // could be written into the status field (or the record VERIFIED for anyone)
      if (status && !ALLOWED_STATUSES.includes(status)) {
        throw new ValidationError(`Invalid verification status. Must be one of: ${ALLOWED_STATUSES.join(', ')}`);
      }

      // C5 FIX: verify the caller owns this record before allowing changes
      const existing = await prisma.phoneValidation.findUnique({
        where: { id: req.params.id as string },
      });
      if (!existing) throw new NotFoundError('Phone validation');
      if (!req.enumerator!.isAdmin && existing.enumeratorId !== req.enumerator!.id) {
        throw new ForbiddenError('You can only update your own phone verification records');
      }

      const validation = await prisma.phoneValidation.update({
        where: { id: req.params.id as string },
        data: {
          status,
          remarks,
          verifiedAt: status === 'VERIFIED' ? new Date() : undefined,
        },
      });

      res.json({ success: true, data: validation });
    } catch (error) {
      next(error);
    }
  }
}

