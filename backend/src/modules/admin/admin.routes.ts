import { Router } from 'express';
import { authMiddleware, adminOnly } from '../../middleware/auth';
import { prisma } from '../../config/database';
import bcrypt from 'bcryptjs';
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { ValidationError, NotFoundError } from '../../utils/errors';
import { createEnumeratorSchema, updateEnumeratorSchema } from '../../schemas/request-schemas';
import { emitToDistrictAndAdmins } from '../../realtime/socket';

/**
 * L1 FIX: enforce minimum password strength before hashing.
 * Requires: 10+ chars, 1 uppercase, 1 lowercase, 1 number, 1 special char.
 */
function validatePassword(password: string) {
  if (password.length < 10) throw new ValidationError('Password must be at least 10 characters long');
  if (!/[A-Z]/.test(password)) throw new ValidationError('Password must contain at least one uppercase letter');
  if (!/[a-z]/.test(password)) throw new ValidationError('Password must contain at least one lowercase letter');
  if (!/[0-9]/.test(password)) throw new ValidationError('Password must contain at least one number');
  if (!/[^A-Za-z0-9]/.test(password)) throw new ValidationError('Password must contain at least one special character');
}

const router = Router();
router.use(authMiddleware, adminOnly);

// Dashboard stats
router.get('/analytics', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const [totalStakeholders, completedSurveys, pendingSync, failedSync] = await Promise.all([
      prisma.stakeholder.count(),
      prisma.survey.count({ where: { isCompleted: true } }),
      prisma.syncQueue.count({ where: { status: 'PENDING' } }),
      prisma.syncQueue.count({ where: { status: 'FAILED' } }),
    ]);

    res.json({
      success: true,
      data: { totalStakeholders, completedSurveys, pendingSync, failedSync },
    });
  } catch (error) {
    next(error);
  }
});

// List enumerators
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
    // M5 FIX: validate + enforce length limits via Zod
    const { loginId, password, name, phone, email, isAdmin, districtIds } = createEnumeratorSchema.parse(req.body);

    // L1 FIX: enforce password strength before hashing
    validatePassword(password);

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
    // M5 FIX: validate + enforce length limits via Zod
    const { name, phone, email, isActive, password } = updateEnumeratorSchema.parse(req.body);

    const updateData: any = {};
    if (name) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password) {
      // L1 FIX: enforce password strength on updates too
      validatePassword(password);
      updateData.passwordHash = await bcrypt.hash(password, 12);
    }

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
    const unlockedStakeholders = await prisma.stakeholder.findMany({
      where: { lockedById: enumeratorId },
      select: { id: true, district: true },
    });

    await prisma.stakeholder.updateMany({
      where: { lockedById: enumeratorId },
      data: { lockedById: null, lockedAt: null }
    });

    const affectedDistricts = [...new Set(unlockedStakeholders.map(s => s.district).filter(Boolean))];
    affectedDistricts.forEach((district) => {
      emitToDistrictAndAdmins(district, 'stakeholder:unlocked', {
        stakeholderIds: unlockedStakeholders.filter(s => s.district === district).map(s => s.id),
        reason: 'enumerator_deactivated',
        district,
      });
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

// ============================================================================
// SURVEY DATA EXPORT — Maps to client's listing.* schema
// ============================================================================

// List completed surveys for export selection (includes export status from DB)
router.get('/export/surveys/list', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const surveys = await prisma.survey.findMany({
      where: { isCompleted: true, isDraft: false },
      select: {
        id: true,
        businessName: true,
        businessCategory: true,
        district: true,
        city: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get all exported survey IDs
    const exports = await prisma.surveyExport.findMany({
      select: { surveyId: true, exportedAt: true },
    });
    const exportedMap = new Map(exports.map(e => [e.surveyId, e.exportedAt]));

    const result = surveys.map(s => ({
      ...s,
      isExported: exportedMap.has(s.id),
      exportedAt: exportedMap.get(s.id) || null,
    }));

    // Sort: new (not exported) on top, then by date desc
    result.sort((a, b) => {
      if (a.isExported !== b.isExported) return a.isExported ? 1 : -1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// POST: export specific surveys by IDs and mark them as exported
router.post('/export/surveys', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { ids } = req.body;
    const where: any = { isCompleted: true, isDraft: false };
    if (ids && Array.isArray(ids) && ids.length > 0) {
      where.id = { in: ids };
    }
    const surveys = await prisma.survey.findMany({ where, orderBy: { createdAt: 'desc' } });
    const sql = generateExportSQL(surveys);

    // Mark these surveys as exported
    const exportedBy = req.enumerator?.id || null;
    for (const s of surveys) {
      await prisma.surveyExport.upsert({
        where: { surveyId: s.id },
        update: { exportedAt: new Date(), exportedBy },
        create: { surveyId: s.id, exportedBy },
      });
    }

    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="mahaatithi_to_listing_export_${new Date().toISOString().slice(0,10)}.sql"`);
    res.send(sql);
  } catch (error) {
    next(error);
  }
});

// GET: export all completed surveys
router.get('/export/surveys', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const surveys = await prisma.survey.findMany({
      where: { isCompleted: true, isDraft: false },
      orderBy: { createdAt: 'desc' },
    });
    const sql = generateExportSQL(surveys);
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="mahaatithi_to_listing_export_${new Date().toISOString().slice(0,10)}.sql"`);
    res.send(sql);
  } catch (error) {
    next(error);
  }
});

function generateExportSQL(surveys: any[]): string {
    const CAT_MAP: Record<string, string> = {
      'Accommodations': '24f3916c-a227-42b6-86d5-cb493b0e0a4a',
      'Cuisine': '09247453-eec9-4e8b-9b19-219e07813b00',
      'Experiences and Activities': 'c4e5ba48-90e8-4107-9abb-c3188c07ae18',
      'Experiences and Activities Slots': '7110589d-e6dc-441c-9c76-25b2e5579be5',
      'Tour Guide': 'd42e5f37-7769-480b-8d88-4d8f2ae11a70',
      'Tour Operator / Travel Agent / DMC': '9e801ff4-9dd0-48a8-81cc-660f5457158b',
      'Aqua Tourism': 'f64bf634-df9e-4787-897d-e06b7380f724',
      'Guided Tours': '3c387b3f-259f-4eca-a702-b3fb85317dee',
      'Events and Festivals': '86841a14-6545-4287-96ee-009a5e3063ab',
      'Handicrafts and Souvenirs': '0b5503ae-7861-49df-ab1e-747b356f15fa',
    };

    const esc = (v: any): string => {
      if (v === null || v === undefined) return 'NULL';
      return `'${String(v).replace(/'/g, "''")}'`;
    };

    const lines: string[] = [
      '-- ==========================================================',
      '-- MahaAtithi → Client Listing Platform Export',
      `-- Generated: ${new Date().toISOString()}`,
      `-- Total surveys: ${surveys.length}`,
      '-- ==========================================================',
      '', 'BEGIN;', '',
    ];

    for (const s of surveys) {
      const catId = s.businessCategory && CAT_MAP[s.businessCategory] ? `'${CAT_MAP[s.businessCategory]}'::uuid` : 'NULL';
      const slug = (s.businessName || 'business').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50) + '-' + s.id.slice(0, 8);

      lines.push(`-- Survey: ${s.id}`);
      lines.push(`WITH new_listing AS (`);
      lines.push(`  INSERT INTO listing.listings (id, user_id, slug, category_id, name_of_business, name_of_owner, description, tour_policies, agree_terms_conditions, declare_information_correct, financial_losses_risk_decleration, save_listing_as_pending, udyam_aadhar_registration_number, approval_status, platform_fee_status, view_count, admin_remark, created_at, updated_at, is_archived)`);
      lines.push(`  VALUES (gen_random_uuid(), NULL, ${esc(slug)}, ${catId}, ${esc(s.businessName)}, ${esc(s.ownerName)}, ${esc(s.description)}, ${esc(s.accommodationPolicies)}, ${s.agreedToTerms}, ${s.declaredInfoCorrect}, ${s.acknowledgedDotLiability}, true, ${esc(s.udyamAadharRegNo)}, 'pending', 'pending', 0, ${esc('MIGRATION: survey_id=' + s.id)}, ${esc(s.createdAt?.toISOString())}, ${esc(s.updatedAt?.toISOString())}, false)`);
      lines.push(`  RETURNING id`);
      lines.push(`), new_contact AS (`);
      lines.push(`  INSERT INTO listing.contact_details (id, listing_id, business_address, city_name, district_name, pin_code, state_name, country_name, latitude, longitude, email_address, mobile_number, country_code)`);
      lines.push(`  SELECT gen_random_uuid(), id, ${esc(s.businessAddress)}, ${esc(s.city)}, ${esc(s.district)}, ${esc(s.pinCode)}, 'Maharashtra', 'India', ${s.latitude != null ? `'${s.latitude}'` : 'NULL'}, ${s.longitude != null ? `'${s.longitude}'` : 'NULL'}, ${esc(s.email)}, ${esc(s.mobileNumber)}, '+91' FROM new_listing RETURNING listing_id`);
      lines.push(`), new_doc AS (`);
      lines.push(`  INSERT INTO listing.business_documents (id, listing_id, about_business) SELECT gen_random_uuid(), id, ${esc(s.aboutBusiness)} FROM new_listing RETURNING listing_id`);
      lines.push(`)`);

      const wh = s.workingHours as any[] | null;
      if (wh && Array.isArray(wh) && wh.length > 0) {
        lines.push(`, new_wh AS (`);
        lines.push(`  INSERT INTO listing.working_hours (id, listing_id, day_of_week, open_all_day, close_all_day, open_specific_hours)`);
        lines.push(`  SELECT gen_random_uuid(), nl.id, d.day_of_week, d.open_all_day, d.close_all_day, d.open_specific_hours FROM new_listing nl, (VALUES`);
        lines.push(wh.map(d => `    ('${d.day}', ${d.type === 'open_all_day'}, ${d.type === 'closed'}, ${d.type === 'hours'})`).join(',\n'));
        lines.push(`  ) AS d(day_of_week, open_all_day, close_all_day, open_specific_hours) RETURNING id, day_of_week`);
        lines.push(`)`);
      }

      const rooms = s.rooms as any[] | null;
      if (rooms && Array.isArray(rooms) && rooms.length > 0 && s.businessCategory === 'Accommodations') {
        lines.push(`, new_rooms AS (`);
        lines.push(`  INSERT INTO listing.accommodations_rooms (id, listing_id, room_title, price, adult_capacity)`);
        lines.push(`  SELECT gen_random_uuid(), nl.id, d.room_title, d.price, d.adult_capacity FROM new_listing nl, (VALUES`);
        lines.push(rooms.map(r => `    (${esc(r.name || r.type || 'Room')}, ${parseFloat(r.price) || 0}::real, ${parseInt(r.capacity) || 2})`).join(',\n'));
        lines.push(`  ) AS d(room_title, price, adult_capacity) RETURNING id`);
        lines.push(`)`);
      }

      lines.push(`SELECT 1;`);
      lines.push('');
    }

    lines.push('COMMIT;');
    return lines.join('\n');
}

export default router;
