import { Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { AuthenticatedRequest } from '../../middleware/auth';
import { NotFoundError, ValidationError } from '../../utils/errors';

export class PhoneValidationController {
  async create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { stakeholderId, phoneNumber, status, method, remarks } = req.body;

      if (!stakeholderId || !phoneNumber) {
        throw new ValidationError('Stakeholder ID and phone number are required');
      }

      if (!['PENDING_VERIFICATION', 'VERIFIED', 'FAILED'].includes(status)) {
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
      const validations = await prisma.phoneValidation.findMany({
        where: { stakeholderId: (req.params.stakeholderId as string) },
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

      const validation = await prisma.phoneValidation.update({
        where: { id: (req.params.id as string) },
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
