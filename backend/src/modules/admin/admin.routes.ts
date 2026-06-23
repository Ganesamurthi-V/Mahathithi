import { Router } from 'express';
import { authMiddleware, adminOnly } from '../../middleware/auth';
import { prisma } from '../../config/database';
import bcrypt from 'bcryptjs';
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { ValidationError, NotFoundError } from '../../utils/errors';

const router = Router();

router.use(authMiddleware);
router.use(adminOnly);

// ============================================================================
// ENUMERATOR MANAGEMENT
// ============================================================================

// List all enumerators
router.get('/enumerators', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const enumerators = await prisma.enumerator.findMany({
      include: {
        districts: { include: { district: true } },
        _count: { select: { surveys: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: enumerators.map(e => ({
        id: e.id,
        loginId: e.loginId,
        name: e.name,
        phone: e.phone,
        email: e.email,
        isActive: e.isActive,
        isAdmin: e.isAdmin,
        districts: e.districts.map(d => ({ id: d.district.id, name: d.district.name })),
        surveysCount: e._count.surveys,
        createdAt: e.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Create enumerator
router.post('/enumerators', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { loginId, password, name, phone, email, isAdmin, districtIds } = req.body;

    if (!loginId || !password || !name) {
      throw new ValidationError('Login ID, password, and name are required');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const enumerator = await prisma.enumerator.create({
      data: {
        loginId,
        passwordHash,
        name,
        phone,
        email,
        isAdmin: isAdmin || false,
      },
    });

    // Assign districts
    if (districtIds && districtIds.length > 0) {
      await prisma.enumeratorDistrict.createMany({
        data: districtIds.map((districtId: string) => ({
          enumeratorId: enumerator.id,
          districtId,
        })),
      });
    }

    await prisma.auditLog.create({
      data: {
        action: 'enumerator_created',
        entityType: 'enumerator',
        entityId: enumerator.id,
        enumeratorId: req.enumerator!.id,
        details: { loginId, name, districtIds },
      },
    });

    res.status(201).json({ success: true, data: { id: enumerator.id, loginId, name } });
  } catch (error) {
    next(error);
  }
});

// Update enumerator
router.patch('/enumerators/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { name, phone, email, isActive, password } = req.body;

    const updateData: any = {};
    if (name) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password) updateData.passwordHash = await bcrypt.hash(password, 12);

    const enumerator = await prisma.enumerator.update({
      where: { id: (req.params.id as string) },
      data: updateData,
    });

    res.json({ success: true, data: enumerator });
  } catch (error) {
    next(error);
  }
});

// Delete enumerator (Soft Delete)
router.delete('/enumerators/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const enumeratorId = req.params.id as string;
    
    // Prevent self-deletion
    if (enumeratorId === req.enumerator!.id) {
      throw new ValidationError('You cannot delete your own account');
    }

    const enumerator = await prisma.enumerator.update({
      where: { id: enumeratorId },
      data: { isActive: false },
    });

    // Delete all active sessions to force logout on their mobile app
    await prisma.session.deleteMany({ where: { enumeratorId } });
    
    // Unlock any stakeholders they have locked so other enumerators can work on them
    await prisma.stakeholder.updateMany({
      where: { lockedById: enumeratorId },
      data: { lockedById: null, lockedAt: null }
    });

    // Remove their assigned districts so they don't show up in metrics
    await prisma.enumeratorDistrict.deleteMany({
      where: { enumeratorId }
    });

    await prisma.auditLog.create({
      data: {
        action: 'enumerator_deleted',
        entityType: 'enumerator',
        entityId: enumeratorId,
        enumeratorId: req.enumerator!.id,
        details: { loginId: enumerator.loginId, name: enumerator.name },
      },
    });

    res.json({ success: true, message: 'Enumerator deleted (deactivated) successfully' });
  } catch (error) {
    next(error);
  }
});
router.put('/enumerators/:id/districts', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { districtIds } = req.body;

    if (!districtIds || !Array.isArray(districtIds)) {
      throw new ValidationError('districtIds array is required');
    }

    // Remove existing assignments
    await prisma.enumeratorDistrict.deleteMany({
      where: { enumeratorId: (req.params.id as string) },
    });

    // Create new assignments
    if (districtIds.length > 0) {
      await prisma.enumeratorDistrict.createMany({
        data: districtIds.map((districtId: string) => ({
          enumeratorId: (req.params.id as string),
          districtId,
        })),
      });
    }

    await prisma.auditLog.create({
      data: {
        action: 'districts_assigned',
        entityType: 'enumerator',
        entityId: (req.params.id as string),
        enumeratorId: req.enumerator!.id,
        details: { districtIds },
      },
    });

    res.json({ success: true, message: 'Districts assigned successfully' });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// DISTRICT MANAGEMENT
// ============================================================================

router.get('/districts', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const districts = await prisma.district.findMany({
      include: {
        _count: { select: { enumerators: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Get stakeholder counts per district
    const districtCounts = await prisma.stakeholder.groupBy({
      by: ['district'],
      _count: { id: true },
    });

    const countsMap = new Map(districtCounts.map(d => [d.district?.toUpperCase(), d._count.id]));

    res.json({
      success: true,
      data: districts.map(d => ({
        ...d,
        enumeratorsCount: d._count.enumerators,
        stakeholdersCount: countsMap.get(d.name.toUpperCase()) || 0,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// AUDIT LOGS
// ============================================================================

router.get('/audit-logs', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { page = '1', limit = '50', action, enumeratorId } = req.query;

    const where: any = {};
    if (action) where.action = action;
    if (enumeratorId) where.enumeratorId = enumeratorId;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          enumerator: { select: { name: true, loginId: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page as string) - 1) * parseInt(limit as string),
        take: parseInt(limit as string),
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ success: true, data: { logs, total } });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// ANALYTICS
// ============================================================================

router.get('/analytics', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const [
      totalStakeholders,
      statusCounts,
      districtStats,
      enumeratorStats,
    ] = await Promise.all([
      prisma.stakeholder.count(),
      prisma.stakeholder.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      prisma.stakeholder.groupBy({
        by: ['district'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 20,
      }),
      prisma.survey.groupBy({
        by: ['enumeratorId'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
    ]);

    res.json({
      success: true,
      data: {
        totalStakeholders,
        statusBreakdown: statusCounts.map(s => ({ status: s.status, count: s._count.id })),
        topDistricts: districtStats.map(d => ({ district: d.district, count: d._count.id })),
        enumeratorPerformance: enumeratorStats.map(e => ({
          enumeratorId: e.enumeratorId,
          surveysCompleted: e._count.id,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
