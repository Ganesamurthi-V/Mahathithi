import { Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { AuthenticatedRequest } from '../../middleware/auth';
import { NotFoundError, ForbiddenError } from '../../utils/errors';
import { assertStakeholderAccess } from '../../utils/access-control';
import { createPhoneValidationSchema, updatePhoneValidationSchema } from '../../schemas/request-schemas';

export class PhoneValidationController {
  async create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // M5 FIX: validate + enforce length limits via Zod (replaces hand-rolled checks)
      const { stakeholderId, phoneNumber, status, method, remarks } = createPhoneValidationSchema.parse(req.body);

      // C5/N4 FIX: enforce district access on the write path too. The read and
      // update paths were patched, but create still allowed any enumerator to
      // record a phone validation against a stakeholder in another district (IDOR).
      const stakeholder = await prisma.stakeholder.findUnique({
        where: { id: stakeholderId },
      });
      if (!stakeholder) throw new NotFoundError('Stakeholder');
      assertStakeholderAccess(stakeholder, req.enumerator!.districts, req.enumerator!.isAdmin);

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
      // M5 FIX: validate + enforce length limits via Zod (replaces hand-rolled enum check)
      const { status, remarks } = updatePhoneValidationSchema.parse(req.body);

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

