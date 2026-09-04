import { Router } from 'express';
import { authMiddleware, adminOnly } from '../../middleware/auth';
import { prisma } from '../../config/database';
import { config } from '../../config';
import bcrypt from 'bcryptjs';
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { ValidationError, NotFoundError } from '../../utils/errors';
import { createEnumeratorSchema, updateEnumeratorSchema } from '../../schemas/request-schemas';
import { emitToDistrictAndAdmins } from '../../realtime/socket';
import { broadcastChange } from '../../realtime/events';

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

// ============================================================================
// DASHBOARD ANALYTICS
// ============================================================================
// There used to be TWO `router.get('/analytics')` registrations in this file.
// Express matches the first, so the second never ran — and the second was the one
// returning `topDistricts` and `statusBreakdown`. The admin Dashboard renders its
// "Top Districts by Stakeholder Count" table behind `analytics?.topDistricts &&`,
// so that table has silently never appeared. Merged into this single route; the
// duplicate below has been removed.
//
// The payload is now exactly what the Dashboard reads, and nothing more. Dropped
// because no caller ever consumed them:
//   pendingSync / failedSync   — 2 syncQueue counts, unread by the panel
//   statusBreakdown            — fed a `statusMap` local that was itself unused
//   enumeratorPerformance      — a survey groupBy, unread by the panel
//
// `totalEnumerators` is new and replaces a much more expensive call. DashboardPage
// used to issue getEnumerators() — findMany with nested district joins and a
// per-row survey count, measured at 190ms, the slowest query in the panel — purely
// to render `enumerators.length`. A plain count answers that in one cheap query and
// removes a second HTTP round trip from the Dashboard entirely.
// The two stakeholder-wide aggregates are cached, the rest are always fresh.
//
// Measured cold, both aggregate over the whole 295K-row table:
//   stakeholder.count()                        1462 ms cold /  89 ms warm
//   groupBy district ORDER BY count DESC       3102 ms cold / 125 ms warm
// `take: 10` cannot help the groupBy — ranking districts by size requires
// counting every district first — so a full aggregate is unavoidable. It can,
// however, be made an index-only scan rather than a full table read; see the
// COUNT(*) note on getStakeholderAggregates below.
//
// It is also aggregate data over the imported stakeholder set, which only changes
// during a bulk import. Serving it from a short-lived cache makes the dashboard
// land instantly for every operator instead of each page load paying the scan.
//
// The counters that DO move minute to minute (completedSurveys, exportedSurveys,
// totalEnumerators) are deliberately left uncached: they are cheap (~55 ms each,
// run in parallel) and an admin watching surveys land should see them promptly.
// Caching those too would have made the realtime invalidation pointless, since a
// refetch would just re-read a stale cached number.
// ---------------------------------------------------------------------------
// Stakeholder aggregates: ONE cached source for both the Dashboard and Districts.
// ---------------------------------------------------------------------------
//
// THE SLOW QUERY, AND WHY IT WAS SLOW
// This used `_count: { id: true }`, which Prisma compiles to COUNT(id). Because
// `id` is not part of stakeholders_district_idx (district), Postgres cannot serve
// that with an index-only scan and falls back to reading the whole 122 MB table.
// `_count: true` emits COUNT(*), which references no column and therefore rides
// the existing index. Identical results (verified: 37 groups, 295,176 total).
//
// Measured on the live database:
//
//   COUNT(id) -> Parallel Seq Scan         15,655 buffers (~122 MB)  187 ms warm
//   COUNT(*)  -> Parallel Index Only Scan   3,661 buffers (~29 MB)    94 ms warm
//
// The buffer count is the number that matters. Warm, both are acceptable — the
// seq scan is only ~2x slower once the table is already in shared_buffers. But it
// touches 4.3x more data, so it is far likelier to be evicted and to be read from
// disk, and a COLD seq scan here measured over 3 s. That is the 2-3 s stall this
// was reported as; reducing the working set from 122 MB to 29 MB is what fixes it.
//
// The `orderBy: { _count: { id: 'desc' } }` was also removed: it reintroduced
// COUNT(id) into the SQL and added a Sort node on top. There are only ~36 rows in
// the result, so ordering them in JS is free and keeps the emitted SQL to exactly
// the shape measured above.
//
// There were also TWO of these aggregates — one here and a near-identical
// getDistrictCountsMap for the Districts page — each with its own cache, so the
// full scan ran twice as often as it needed to. They are now one cache with two
// views: an ordered array and an upper-cased lookup map.
//
// Remaining cost is heap fetches: the table is only ~88% all-visible, so even the
// index-only scan touched the heap ~34850 times. See the VACUUM in
// prisma/migrations/20260904_vacuum_stakeholders/migration.sql.
const STAKEHOLDER_AGG_TTL_MS = 5 * 60 * 1000;

interface StakeholderAggregates {
  at: number;
  totalStakeholders: number;
  /** Districts ordered by stakeholder count, descending. */
  districts: { district: string | null; count: number }[];
  /** Same counts keyed by UPPER(district) for direct lookup. */
  byDistrict: Map<string, number>;
}

let stakeholderAggCache: StakeholderAggregates | null = null;
// Guards against a stampede: if several requests arrive while a refresh is in
// flight they all await the same promise instead of each launching a scan.
let stakeholderAggInflight: Promise<StakeholderAggregates> | null = null;

async function loadStakeholderAggregates(): Promise<StakeholderAggregates> {
  const [totalStakeholders, districtStats] = await Promise.all([
    prisma.stakeholder.count(),
    // No `take`: returning only the ten largest districts hid the districts where
    // surveys are actually happening, and ranking by size requires counting every
    // district anyway, so the scan is identical either way.
    prisma.stakeholder.groupBy({
      by: ['district'],
      _count: true,
    }),
  ]);

  const districts = districtStats
    .map(d => ({ district: d.district, count: d._count }))
    .sort((a, b) => b.count - a.count);

  return {
    at: Date.now(),
    totalStakeholders,
    districts,
    byDistrict: new Map(districts.map(d => [(d.district || '').toUpperCase(), d.count])),
  };
}

/**
 * Serve-stale-while-revalidating.
 *
 * A plain TTL cache still makes one unlucky request per period wait out the full
 * aggregate. Once a value exists, an expired entry is returned immediately and the
 * refresh happens in the background, so no admin request ever blocks on the scan
 * again. Only the very first call after boot awaits it.
 */
async function getStakeholderAggregates(): Promise<StakeholderAggregates> {
  const fresh = stakeholderAggCache && Date.now() - stakeholderAggCache.at < STAKEHOLDER_AGG_TTL_MS;
  if (fresh) return stakeholderAggCache!;

  if (!stakeholderAggInflight) {
    stakeholderAggInflight = loadStakeholderAggregates()
      .then(next => {
        stakeholderAggCache = next;
        return next;
      })
      .finally(() => {
        stakeholderAggInflight = null;
      });
  }

  // Stale data is fine for an import-driven aggregate; a blocked request is not.
  if (stakeholderAggCache) return stakeholderAggCache;
  return stakeholderAggInflight;
}

/** Per-district stakeholder counts, keyed by UPPER(district). */
async function getDistrictCountsMap(): Promise<Map<string, number>> {
  return (await getStakeholderAggregates()).byDistrict;
}

/** Call after a bulk stakeholder import so the dashboard reflects it immediately. */
export function invalidateStakeholderAggregates(): void {
  stakeholderAggCache = null;
}

/**
 * Completed surveys per district, for the Dashboard's district table.
 *
 * Grouped on `stakeholders.district`, NOT `surveys.district`. That matters:
 * `surveys.district` is a free-text field the enumerator fills in on the form and
 * is null on every survey created before that field existed, so grouping on it
 * would silently under-count. `stakeholders.district` is the canonical assignment
 * and is the same key `topDistricts` is built from, which is what lets the total
 * and completed figures in a single row be compared meaningfully.
 *
 * Deliberately NOT cached, unlike the stakeholder aggregates above. This is the
 * number that moves as enumerators submit work, and it is cheap — the surveys
 * table is small and the join is on an indexed primary key, versus the 295K-row
 * scan that forced caching for the stakeholder side.
 */
async function getCompletedSurveysByDistrict(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ district: string | null; count: bigint }[]>`
    SELECT s.district AS district, COUNT(*) AS count
    FROM surveys sv
    JOIN stakeholders s ON s.id = sv.stakeholder_id
    WHERE sv.is_completed = true
    GROUP BY s.district
  `;

  // Keyed upper-case so a casing difference between the two groupings cannot
  // cause a district to silently report zero completions.
  return new Map(rows.map(r => [(r.district || '').toUpperCase(), Number(r.count)]));
}

router.get('/analytics', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const [agg, completedSurveys, exportedSurveys, totalEnumerators, completedByDistrict] =
      await Promise.all([
        getStakeholderAggregates(),
        prisma.survey.count({ where: { isCompleted: true } }),
        prisma.surveyExport.count(),
        prisma.enumerator.count(),
        getCompletedSurveysByDistrict(),
      ]);

    // The cached district totals are merged with the live completion counts here
    // rather than inside getStakeholderAggregates, so the completed figures stay
    // fresh even while the 5-minute stakeholder cache is still being served.
    //
    // Ordering is by survey activity first, stakeholder volume second. Ranking
    // purely by volume put ten districts with zero completions on the dashboard
    // while hiding the only district with any, which is the opposite of what a
    // progress table is for. Districts with no activity still appear once the
    // active ones run out, so large untouched districts remain visible.
    const topDistricts = agg.districts
      .map(d => {
        const completed = completedByDistrict.get((d.district || '').toUpperCase()) || 0;
        return {
          district: d.district,
          count: d.count,
          completedSurveys: completed,
          // Share of that district's stakeholders with a completed survey. Guarded
          // against a zero denominator, which would otherwise yield NaN in the UI.
          coverage: d.count > 0 ? Number(((completed / d.count) * 100).toFixed(2)) : 0,
        };
      })
      .sort((a, b) => b.completedSurveys - a.completedSurveys || b.count - a.count)
      .slice(0, 10);

    res.json({
      success: true,
      data: {
        totalStakeholders: agg.totalStakeholders,
        completedSurveys,
        exportedSurveys,
        totalEnumerators,
        topDistricts,
      },
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

    // Every open admin session updates immediately. auditLogs is included
    // because the write above appended an entry, and analytics because the
    // enumerator count changed.
    broadcastChange(['enumerators', 'analytics', 'auditLogs'], {
      action: 'create',
      entityId: enumerator.id,
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

    // Covers the Activate/Deactivate toggle, which changes the row's badge for
    // every admin currently looking at the enumerators table.
    broadcastChange(['enumerators', 'analytics'], {
      action: 'update',
      entityId: enumerator.id,
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

    // Deleting touches a lot: the enumerator list, the district assignment
    // counts, previously-locked stakeholders that are now free, and the counters.
    // The per-district stakeholder:unlocked events above already told field
    // devices to restore those rows; this covers the admin-side tables.
    broadcastChange(['enumerators', 'districts', 'stakeholders', 'analytics', 'auditLogs'], {
      action: 'delete',
      entityId: enumeratorId,
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

    // Changes the badges in the enumerators table AND the "assigned enumerators"
    // column on the districts page — two pages that previously only caught this
    // if the operator navigated away and back.
    broadcastChange(['enumerators', 'districts', 'auditLogs'], {
      action: 'update',
      entityId: req.params.id as string,
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

    // PERF: per-district stakeholder counts, from a short-lived cache.
    // This groupBy aggregates all 295K rows (~130 ms warm, seconds cold) and the
    // underlying data only changes on a bulk import, so recomputing it on every
    // visit to the Districts page is pure waste.
    //
    // The completion counts are fetched alongside but deliberately uncached, for
    // the same reason as on the dashboard: they move as enumerators submit work.
    const [countsMap, completedByDistrict] = await Promise.all([
      getDistrictCountsMap(),
      getCompletedSurveysByDistrict(),
    ]);

    res.json({
      success: true,
      data: districts.map(d => {
        const key = d.name.toUpperCase();
        const stakeholdersCount = countsMap.get(key) || 0;
        const completedSurveysCount = completedByDistrict.get(key) || 0;
        return {
          ...d,
          enumeratorsCount: d._count.enumerators,
          stakeholdersCount,
          completedSurveysCount,
          coverage: stakeholdersCount > 0
            ? Number(((completedSurveysCount / stakeholdersCount) * 100).toFixed(2))
            : 0,
        };
      }),
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

// NOTE: a second `router.get('/analytics')` used to sit here. It was unreachable
// (Express matches the first registration, near the top of this file) and its
// exclusive fields — topDistricts, statusBreakdown, enumeratorPerformance — never
// reached the client. topDistricts has been folded into the live route above;
// statusBreakdown and enumeratorPerformance were dropped as unused.

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
    const mediaBySurvey = await fetchExportMedia(surveys.map(s => s.id));
    const sql = generateExportSQL(surveys, mediaBySurvey);

    // Mark these surveys as exported
    const exportedBy = req.enumerator?.id || null;
    for (const s of surveys) {
      await prisma.surveyExport.upsert({
        where: { surveyId: s.id },
        update: { exportedAt: new Date(), exportedBy },
        create: { surveyId: s.id, exportedBy },
      });
    }

    // Rows just flipped from "New" to "Exported" and the dashboard's exported
    // counter moved. Without this, a second admin would keep seeing them as new
    // and could export the same surveys again.
    broadcastChange(['exports', 'analytics'], { action: 'update' });

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
    const mediaBySurvey = await fetchExportMedia(surveys.map(s => s.id));
    const sql = generateExportSQL(surveys, mediaBySurvey);
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="mahaatithi_to_listing_export_${new Date().toISOString().slice(0,10)}.sql"`);
    res.send(sql);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// MEDIA EXPORT MAPPING (see media_mapping.md)
// ============================================================================

/**
 * Build the permanent, non-expiring object URL the client will use.
 *
 * Two things must never be exported:
 *   • media.file_url — a presigned URL carrying X-Amz-Expires=3600, so it is
 *     already dead by the time the client imports the SQL.
 *   • media.file_path bare — that is only the S3 object key, not fetchable.
 *
 * The permanent form is `<publicBase>/<file_path>`. Each path segment is
 * percent-encoded so keys containing spaces or unicode still resolve, while the
 * '/' separators are preserved.
 */
function buildMediaUrl(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const encoded = String(filePath)
    .replace(/^\/+/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  return `${config.aws.s3PublicBaseUrl}/${encoded}`;
}

interface SurveyMediaUrls {
  displayImageUrl: string | null;
  gstCertUrl: string | null;
  panCardUrl: string | null;
  establishmentCertUrl: string | null;
}

/**
 * Reduce a survey's media rows to the four URLs the client schema accepts.
 *
 * Rows arrive ordered by created_at ASC, so "first wins" is simply the first
 * match encountered — that is the documented rule for BUILDING_FRONT, and it
 * also makes re-uploads of the same document category deterministic.
 *
 * Categories we collect but do NOT export, because the client schema has no
 * column for them: SIGNBOARD, INTERIOR, STAKEHOLDER, ADDITIONAL, DISPLAY_IMAGE,
 * HEADER_SLIDER, CUSTOM_DOC, and all VIDEO rows. listings.header_slider is left
 * NULL as specified — no source field maps to it.
 */
function mapSurveyMedia(mediaRows: any[]): SurveyMediaUrls {
  const result: SurveyMediaUrls = {
    displayImageUrl: null,
    gstCertUrl: null,
    panCardUrl: null,
    establishmentCertUrl: null,
  };

  for (const m of mediaRows) {
    const url = buildMediaUrl(m.filePath);
    if (!url) continue;

    switch (m.photoCategory) {
      case 'BUILDING_FRONT':
        if (m.type === 'PHOTO' && !result.displayImageUrl) result.displayImageUrl = url;
        break;
      // The Prisma enum value is GST_DOC (what the mobile form writes);
      // media_mapping.md refers to it as GST_CERT_DOC. Accept both so the
      // export does not silently drop GST certificates.
      case 'GST_DOC':
      case 'GST_CERT_DOC':
        if (!result.gstCertUrl) result.gstCertUrl = url;
        break;
      case 'PAN_CARD_DOC':
        if (!result.panCardUrl) result.panCardUrl = url;
        break;
      case 'ESTABLISHMENT_CERT_DOC':
        if (!result.establishmentCertUrl) result.establishmentCertUrl = url;
        break;
      default:
        break;
    }
  }

  return result;
}

/**
 * Load exportable media for many surveys in ONE query, keyed by survey id.
 * Avoids an N+1 round-trip per survey when exporting a large batch.
 */
async function fetchExportMedia(surveyIds: string[]): Promise<Map<string, any[]>> {
  const byId = new Map<string, any[]>();
  if (surveyIds.length === 0) return byId;

  const rows = await prisma.media.findMany({
    where: {
      surveyId: { in: surveyIds },
      deletedAt: null,
      type: { in: ['PHOTO', 'DOCUMENT'] },
    },
    select: { surveyId: true, type: true, photoCategory: true, filePath: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const r of rows) {
    const list = byId.get(r.surveyId);
    if (list) list.push(r);
    else byId.set(r.surveyId, [r]);
  }
  return byId;
}

function generateExportSQL(surveys: any[], mediaBySurvey: Map<string, any[]> = new Map()): string {
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

    const totalMediaRows = surveys.reduce((n, s) => n + (mediaBySurvey.get(s.id)?.length || 0), 0);

    const lines: string[] = [
      '-- ==========================================================',
      '-- MahaAtithi → Client Listing Platform Export',
      `-- Generated: ${new Date().toISOString()}`,
      `-- Total surveys: ${surveys.length}`,
      `-- Media records considered: ${totalMediaRows}`,
      '--',
      '-- MEDIA URLS',
      `-- All file URLs below are permanent links of the form:`,
      `--   ${config.aws.s3PublicBaseUrl}/<s3-object-key>`,
      '-- They are NOT presigned and therefore do not expire.',
      '--',
      '-- IMPORTANT: these URLs resolve only if the storage bucket grants read',
      '-- access on the exported prefixes. If the bucket is private, the links',
      '-- will return AccessDenied and the objects must be shared another way',
      '-- (public prefix policy, CDN distribution, or a direct file handover).',
      '--',
      '-- Media mapping applied:',
      '--   BUILDING_FRONT (PHOTO)            -> listings.display_image_url (first only)',
      '--   GST_DOC (DOCUMENT)                -> business_documents.document_name_one[_url]',
      '--   PAN_CARD_DOC (DOCUMENT)           -> business_documents.pan_card_document_url',
      '--   ESTABLISHMENT_CERT_DOC (DOCUMENT) -> business_documents.document_name_two[_url]',
      '--   listings.header_slider is intentionally left NULL (no source field).',
      '-- ==========================================================',
      '', 'BEGIN;', '',
    ];

    for (const s of surveys) {
      const catId = s.businessCategory && CAT_MAP[s.businessCategory] ? `'${CAT_MAP[s.businessCategory]}'::uuid` : 'NULL';
      const slug = (s.businessName || 'business').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50) + '-' + s.id.slice(0, 8);

      // Permanent S3 URLs for this survey's media (never presigned, never bare keys).
      const mediaUrls = mapSurveyMedia(mediaBySurvey.get(s.id) || []);
      // Document slot labels are only set when the matching file actually exists,
      // so the client never sees a label pointing at a NULL URL.
      const docNameOne = mediaUrls.gstCertUrl ? esc('GST Certificate') : 'NULL';
      const docNameTwo = mediaUrls.establishmentCertUrl ? esc('Establishment Certificate') : 'NULL';

      lines.push(`-- Survey: ${s.id}`);
      if (mediaUrls.displayImageUrl || mediaUrls.gstCertUrl || mediaUrls.panCardUrl || mediaUrls.establishmentCertUrl) {
        lines.push(`--   media: display=${mediaUrls.displayImageUrl ? 'yes' : 'no'} gst=${mediaUrls.gstCertUrl ? 'yes' : 'no'} pan=${mediaUrls.panCardUrl ? 'yes' : 'no'} establishment=${mediaUrls.establishmentCertUrl ? 'yes' : 'no'}`);
      } else {
        lines.push(`--   media: none exportable`);
      }
      lines.push(`WITH new_listing AS (`);
      lines.push(`  INSERT INTO listing.listings (id, user_id, slug, category_id, name_of_business, name_of_owner, description, display_image_url, tour_policies, agree_terms_conditions, declare_information_correct, financial_losses_risk_decleration, save_listing_as_pending, udyam_aadhar_registration_number, approval_status, platform_fee_status, view_count, admin_remark, created_at, updated_at, is_archived)`);
      lines.push(`  VALUES (gen_random_uuid(), NULL, ${esc(slug)}, ${catId}, ${esc(s.businessName)}, ${esc(s.ownerName)}, ${esc(s.description)}, ${esc(mediaUrls.displayImageUrl)}, ${esc(s.accommodationPolicies)}, ${s.agreedToTerms}, ${s.declaredInfoCorrect}, ${s.acknowledgedDotLiability}, true, ${esc(s.udyamAadharRegNo)}, 'pending', 'pending', 0, ${esc('MIGRATION: survey_id=' + s.id)}, ${esc(s.createdAt?.toISOString())}, ${esc(s.updatedAt?.toISOString())}, false)`);
      lines.push(`  RETURNING id`);
      lines.push(`), new_contact AS (`);
      lines.push(`  INSERT INTO listing.contact_details (id, listing_id, business_address, city_name, district_name, pin_code, state_name, country_name, latitude, longitude, email_address, mobile_number, country_code)`);
      lines.push(`  SELECT gen_random_uuid(), id, ${esc(s.businessAddress)}, ${esc(s.city)}, ${esc(s.district)}, ${esc(s.pinCode)}, 'Maharashtra', 'India', ${s.latitude != null ? `'${s.latitude}'` : 'NULL'}, ${s.longitude != null ? `'${s.longitude}'` : 'NULL'}, ${esc(s.email)}, ${esc(s.mobileNumber)}, '+91' FROM new_listing RETURNING listing_id`);
      lines.push(`), new_doc AS (`);
      lines.push(`  INSERT INTO listing.business_documents (id, listing_id, about_business, pan_card_document_url, document_name_one, document_name_one_url, document_name_two, document_name_two_url)`);
      lines.push(`  SELECT gen_random_uuid(), id, ${esc(s.aboutBusiness)}, ${esc(mediaUrls.panCardUrl)}, ${docNameOne}, ${esc(mediaUrls.gstCertUrl)}, ${docNameTwo}, ${esc(mediaUrls.establishmentCertUrl)} FROM new_listing RETURNING listing_id`);
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
