import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { NotFoundError, ForbiddenError, ConflictError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { districtScopeFilter } from '../../utils/district-scope';
import { categoryFilter } from '../../utils/category-scope';
import { broadcastChange } from '../../realtime/events';

interface SearchParams {
  name?: string;
  org?: string;
  state?: string;
  district?: string;
  pinCode?: string;
  category?: string;
  nicCode?: string;
  gst?: string;
  taluka?: string;
  city?: string;
  status?: string;
  digipin?: string;
  page: number;
  limit: number;
  assignedDistricts: string[];
  isAdmin: boolean;
}

export class StakeholderService {
  /**
   * Multi-filter search with pagination over 313K+ records.
   * Uses PostgreSQL trigram indexes for fuzzy/partial matching.
   * Enforces district restrictions from JWT.
   */
  async search(params: SearchParams) {
    const {
      name, org, state, district, pinCode, category,
      nicCode, gst, status, taluka, city, digipin, page, limit, assignedDistricts, isAdmin
    } = params;

    const where: Prisma.StakeholderWhereInput = {};
    const conditions: Prisma.StakeholderWhereInput[] = [];

    // === DISTRICT RESTRICTION (Critical Security) ===
    // PERF: exact match on canonicalised names instead of `mode: 'insensitive'`.
    // The insensitive variant compiled to LOWER(district) IN (...), which no
    // index on `district` can serve — every search became a Parallel Seq Scan of
    // 295K rows (422ms warm, 3.4s cold). See utils/district-scope.ts.
    if (!isAdmin) {
      conditions.push(await districtScopeFilter(assignedDistricts));
    }

    // === SEARCH FILTERS ===

    // Name search (uses trigram index for fuzzy matching)
    if (name) {
      conditions.push({
        OR: [
          { companyNameStandardized: { contains: name, mode: 'insensitive' } },
          { companyNameOriginal: { contains: name, mode: 'insensitive' } },
        ],
      });
    }

    // Organization search
    if (org) {
      conditions.push({
        OR: [
          { companyNameStandardized: { contains: org, mode: 'insensitive' } },
          { companyNameOriginal: { contains: org, mode: 'insensitive' } },
        ],
      });
    }

    // State filter
    if (state) {
      conditions.push({ state: { equals: state, mode: 'insensitive' } });
    }

    // District filter (within assigned districts)
    if (district) {
      conditions.push({ district: { contains: district, mode: 'insensitive' } });
    }

    // PIN Code filter (exact or prefix)
    if (pinCode) {
      conditions.push({ pinCode: { startsWith: pinCode } });
    }

    // Category filter.
    //
    // PERF: `contains` + mode:'insensitive' compiles to ILIKE '%x%', which no
    // b-tree can serve, so the planner walked idx_sh_list_global row by row —
    // 155,073 buffers (~1.2 GB) to return 20 rows, discarding 154,276 along the
    // way. That was the most expensive filter in the application.
    //
    // categoryFilter() resolves the input against the ~12 real category values and
    // returns an exact `in` filter, which uses idx_sh_category_list: 23 buffers.
    // Substring semantics are preserved, so 'Hotels' still matches
    // 'Hotels & Resorts' and the result set is unchanged.
    //
    // It returns null only if the canonical list could not be read; in that case
    // fall back to the original ILIKE rather than silently matching nothing.
    if (category) {
      const resolved = await categoryFilter(category);
      conditions.push(resolved ?? { category: { contains: category, mode: 'insensitive' } });
    }

    // NIC Code filter
    if (nicCode) {
      conditions.push({ nicCode: { equals: nicCode } });
    }

    // GST Number filter
    if (gst) {
      conditions.push({ gstNumber: { contains: gst, mode: 'insensitive' } });
    }

    // Taluka filter
    if (taluka) {
      conditions.push({ taluka: { equals: taluka, mode: 'insensitive' } });
    }

    // City/Village filter
    if (city) {
      conditions.push({
        OR: [
          { city: { contains: city, mode: 'insensitive' } },
          { village: { contains: city, mode: 'insensitive' } },
        ],
      });
    }

    // Status filter
    if (status) {
      conditions.push({ status: status as any });
    }

    // DIGIPIN filter
    if (digipin) {
      conditions.push({ digipin: { equals: digipin, mode: 'insensitive' } });
    }

    if (!isAdmin) {
      conditions.push({ status: { not: 'CLOSED' } });
    }

    if (conditions.length > 0) {
      where.AND = conditions;
    }

    const skip = (page - 1) * limit;

    // PERF: the exact COUNT was the most expensive part of every filtered search.
    //
    // Prisma ran `stakeholder.count({ where })` alongside the page purely to render
    // "of N total". With a text filter that is a Bitmap Heap Scan re-checking the
    // ILIKE predicate against every match. Measured live for name=hotel:
    //
    //   page query (LIMIT 20)   335 ms,   565 buffers
    //   COUNT(*) same WHERE    2307 ms,  9067 buffers   <-- 7x the page itself
    //
    // So: skip the total entirely once the caller has narrowed the result set, and
    // derive pagination from an over-fetch instead.
    //
    // `hasMore` comes from requesting one row beyond the page and seeing whether it
    // arrives. That is exact, costs nothing, and does not depend on a total at all.
    //
    // The unfiltered view keeps its exact total: with no predicate it is a cheap
    // index-only scan (~140 ms) and "295,176 total" is the one place the figure is
    // genuinely useful.
    //
    // A bounded count was tried first — `findMany({ select: { id }, take: cap })`,
    // intending to let Postgres stop at the cap. Prisma appends `ORDER BY id ASC`
    // to that query, which forces it to locate matches in id order and defeats the
    // early exit: it measured 7407 ms, i.e. worse than the count it replaced. Hence
    // no count at all rather than a cheaper one.
    //
    // The non-admin district scope is excluded from this test on purpose: it is
    // always present, so counting it as a filter would mean enumerators never see a
    // total. It is also an indexed equality, not the expensive part.
    const hasUserFilters = Boolean(
      name || org || state || district || pinCode || category ||
      nicCode || gst || taluka || city || status || digipin
    );

    const countPromise: Promise<number | null> = hasUserFilters
      ? Promise.resolve(null)
      : prisma.stakeholder.count({ where });

    const [rowsPlusOne, exactTotal] = await Promise.all([
      prisma.stakeholder.findMany({
        where,
        select: {
          id: true,
          primaryKeyId: true,
          uin: true,
          companyNameStandardized: true,
          companyNameOriginal: true,
          city: true,
          taluka: true,
          village: true,
          district: true,
          state: true,
          pinCode: true,
          category: true,
          nicCode: true,
          nicDescription: true,
          gstNumber: true,
          companyStatus: true,
          status: true,
          digipin: true,
          lockedById: true,
          _count: {
            select: { surveys: true }
          }
        },
        skip,
        // One extra row, discarded before returning — see the hasMore note above.
        take: limit + 1,
        orderBy: [
          { priorityWeight: 'desc' },
          { companyNameStandardized: 'asc' },
        ],
      }),
      countPromise,
    ]);

    const hasMore = rowsPlusOne.length > limit;
    const stakeholders = hasMore ? rowsPlusOne.slice(0, limit) : rowsPlusOne;

    return {
      stakeholders: stakeholders.map(s => ({
        ...s,
        status: s.status === 'OPEN' && s._count?.surveys > 0 ? 'PARTIAL_COMPLETED' : s.status,
      })),
      pagination: {
        page,
        limit,
        // null on a filtered search — the client must not present a total it was
        // never given. Kept numeric and exact for the unfiltered view.
        total: exactTotal,
        totalKnown: exactTotal !== null,
        totalPages: exactTotal !== null ? Math.ceil(exactTotal / limit) : null,
        // From the over-fetch, so it is correct whether or not a total exists.
        hasMore,
      },
    };
  }

  /**
   * Get full stakeholder detail
   */
  // X2 FIX: thread the caller's enumeratorId so non-admins only see their own
  // surveys/phone validations for this stakeholder, not other enumerators'.
  async getById(id: string, enumeratorId: string, enumeratorDistricts: string[], isAdmin: boolean) {
    const stakeholder = await prisma.stakeholder.findUnique({
      where: { id },
      include: {
        surveys: {
          // X2 FIX: admins see all surveys; enumerators see only their own.
          where: isAdmin ? undefined : { enumeratorId },
          include: {
            // B5 FIX: exclude soft-deleted (tombstoned) media so deleted
            // S3 keys / presigned URLs aren't leaked in the detail view.
            media: { where: { deletedAt: null } },
          },
        },
        // X2 FIX: scope phone validations to the caller as well.
        phoneValidations: isAdmin ? true : { where: { enumeratorId } },
        lockedBy: {
          select: { id: true, name: true },
        },
      },
    });

    if (!stakeholder) {
      throw new NotFoundError('Stakeholder');
    }

    // District and status restriction check
    if (!isAdmin) {
      if (stakeholder.status === 'CLOSED') {
        throw new NotFoundError('Stakeholder');
      }
      if (stakeholder.district) {
        const hasAccess = enumeratorDistricts.some(
          d => d.toUpperCase() === stakeholder.district!.toUpperCase()
        );
        if (!hasAccess) {
          throw new ForbiddenError('You are not assigned to this district');
        }
      }
    }

    return stakeholder;
  }

  /**
   * Get assigned stakeholders for offline sync (legacy — returns all records in one shot).
   * Kept for backward compatibility; prefer getAssignedPage for large datasets.
   */
  async getAssigned(enumeratorId: string, districts: string[], since?: string) {
    const where: Prisma.StakeholderWhereInput = {
      district: {
        in: districts,
        mode: 'insensitive',
      },
    };

    // If `since` timestamp provided, only return updated records
    if (since) {
      where.updatedAt = { gt: new Date(since) };
    }

    // Only return OPEN stakeholders
    where.status = 'OPEN';

    // NOTE: this is the offline-sync mirror feed — the mobile SQLite store
    // (stakeholderDao.upsertMany) persists ~37 of these scalar columns, so we
    // intentionally return the full row here. Do NOT narrow this to a list-style
    // select; doing so silently drops columns from every device's local mirror.
    const stakeholders = await prisma.stakeholder.findMany({
      where,
      include: {
        _count: {
          select: { surveys: true }
        }
      },
      orderBy: { primaryKeyId: 'asc' },
    });

    return stakeholders.map(s => ({
      ...s,
      status: s.status === 'OPEN' && s._count?.surveys > 0 ? 'PARTIAL_COMPLETED' : s.status,
    }));
  }

  /**
   * Paginated version of getAssigned — cursor-based, safe for 1 L+ rows.
   *
   * Uses `primaryKeyId` (the auto-increment PK) as a stable cursor so that:
   *  • each page is a deterministic slice of the full result set
   *  • inserting new rows during sync never causes a row to be skipped or
   *    returned twice
   *  • the query hits the PK index and stays fast regardless of table size
   *
   * @param after  cursor — the primaryKeyId of the last row from the
   *               previous page (omit / 0 for the first page)
   * @param pageSize rows per page (default 2 000, max 5 000)
   */
  async getAssignedPage(
    enumeratorId: string,
    districts: string[],
    after: number = 0,
    pageSize: number = 2000,
    since?: string,
  ) {
    const clampedSize = Math.min(Math.max(pageSize, 1), 5000);

    const where: Prisma.StakeholderWhereInput = {
      district: { in: districts, mode: 'insensitive' },
      status: 'OPEN',
    };

    if (since) {
      where.updatedAt = { gt: new Date(since) };
    }

    // Cursor: only rows whose PK is strictly greater than the last seen cursor.
    // For the first page `after` is 0, which is always less than any real PK.
    where.primaryKeyId = { gt: after };

    const stakeholders = await prisma.stakeholder.findMany({
      where,
      include: {
        _count: { select: { surveys: true } },
      },
      orderBy: { primaryKeyId: 'asc' },
      take: clampedSize,
    });

    const rows = stakeholders.map(s => ({
      ...s,
      status: s.status === 'OPEN' && s._count?.surveys > 0 ? 'PARTIAL_COMPLETED' : s.status,
    }));

    const nextCursor = rows.length === clampedSize
      ? rows[rows.length - 1].primaryKeyId
      : null; // null signals "no more pages"

    return {
      stakeholders: rows,
      nextCursor,
      pageSize: clampedSize,
      count: rows.length,
    };
  }

  /**
   * Lock stakeholder when survey is completed.
   * Critical: Once locked, only the locking enumerator can see it.
   */
  async lockStakeholder(stakeholderId: string, enumeratorId: string) {
    const stakeholder = await prisma.stakeholder.findUnique({
      where: { id: stakeholderId },
    });

    if (!stakeholder) {
      throw new NotFoundError('Stakeholder');
    }

    // Already locked by someone else
    if (stakeholder.lockedById && stakeholder.lockedById !== enumeratorId) {
      throw new ConflictError('This stakeholder has already been completed by another enumerator');
    }

    const updated = await prisma.stakeholder.update({
      where: { id: stakeholderId },
      data: {
        status: 'CLOSED',
        lockedById: enumeratorId,
        lockedAt: new Date(),
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'stakeholder_locked',
        entityType: 'stakeholder',
        entityId: stakeholderId,
        enumeratorId,
        details: {
          district: stakeholder.district,
          companyName: stakeholder.companyNameStandardized,
        },
      },
    });

    logger.info(`Stakeholder locked: ${stakeholderId} by enumerator ${enumeratorId}`);

    return updated;
  }

  /**
   * Update stakeholder status
   */
  async updateStatus(stakeholderId: string, status: string, enumeratorId: string) {
    const stakeholder = await prisma.stakeholder.findUnique({
      where: { id: stakeholderId },
    });

    if (!stakeholder) {
      throw new NotFoundError('Stakeholder');
    }

    // Don't allow status change if locked by another enumerator
    if (stakeholder.lockedById && stakeholder.lockedById !== enumeratorId) {
      throw new ConflictError('This stakeholder is locked by another enumerator');
    }

    return prisma.stakeholder.update({
      where: { id: stakeholderId },
      data: { status: status as any },
    });
  }

  /**
   * Update stakeholder details (restricted to specific fields)
   */
  async updateStakeholder(stakeholderId: string, data: any, enumeratorId: string) {
    const stakeholder = await prisma.stakeholder.findUnique({
      where: { id: stakeholderId },
    });

    if (!stakeholder) {
      throw new NotFoundError('Stakeholder');
    }

    // Don't allow edits if locked by someone else
    if (stakeholder.lockedById && stakeholder.lockedById !== enumeratorId) {
      throw new ConflictError('This stakeholder is locked by another enumerator');
    }

    // C6 FIX: district & state intentionally removed from this list.
    // District is the entire access-control boundary — letting an enumerator
    // re-assign a record to their own district would defeat all isolation.
    // Use the admin-only PATCH /admin/stakeholders/:id/relocate for that.
    const allowedFields = [
      'companyNameStandardized', 'addressLine1', 'addressLine2',
      'city', 'taluka', 'village', 'pinCode', 'category',
      'latitude', 'longitude', 'digipin'
    ];
    
    const updateData: any = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return stakeholder; // Nothing to update
    }

    const updated = await prisma.stakeholder.update({
      where: { id: stakeholderId },
      data: updateData,
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'stakeholder_updated',
        entityType: 'stakeholder',
        entityId: stakeholderId,
        enumeratorId,
        details: {
          updatedFields: Object.keys(updateData)
        },
      },
    });

    // An edit made in the admin gallery, or from a field device, now reaches
    // every other open client. The district is passed so enumerators working that
    // area pick up the corrected name/address without re-syncing manually.
    broadcastChange(['stakeholders', 'auditLogs'], {
      action: 'update',
      entityId: stakeholderId,
      district: updated.district,
    });

    return updated;
  }
}
