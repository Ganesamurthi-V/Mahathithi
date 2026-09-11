import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { districtScopeFilter, canonicalizeDistricts } from '../../utils/district-scope';
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
  async getAssigned(
    enumeratorId: string,
    districts: string[],
    since?: string,
    isAdmin: boolean = false,
  ) {
    // Partitioned identically to getAssignedPage. If only the paged feed divided
    // the work, a device falling back to this legacy route would download the whole
    // district and the two endpoints would disagree about what belongs to whom.
    const partitions = await this.getDistrictPartitions(enumeratorId, districts, isAdmin);
    if (partitions.length === 0) return [];

    const isSplit = partitions.some(p => p.total > 1);

    // Unsplit districts keep the original single-query path — no reason to pay for
    // a raw key lookup when the filter is expressible in Prisma.
    const where: Prisma.StakeholderWhereInput = { status: 'OPEN' };
    if (since) where.updatedAt = { gt: new Date(since) };

    if (isSplit) {
      // No LIMIT here because this route is already unbounded; the partition only
      // narrows the result, so this cannot return more than before.
      const pkIds = await this.selectPartitionedPrimaryKeys(
        partitions,
        0,
        since,
        Number.MAX_SAFE_INTEGER,
      );
      if (pkIds.length === 0) return [];
      where.primaryKeyId = { in: pkIds };
    } else {
      where.district = { in: partitions.map(p => p.district) };
    }

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
    isAdmin: boolean = false,
  ) {
    const clampedSize = Math.min(Math.max(pageSize, 1), 5000);

    const partitions = await this.getDistrictPartitions(enumeratorId, districts, isAdmin);

    if (partitions.length === 0) {
      return { stakeholders: [], nextCursor: null, pageSize: clampedSize, count: 0, partitions };
    }

    const where: Prisma.StakeholderWhereInput = { status: 'OPEN' };
    if (since) where.updatedAt = { gt: new Date(since) };
    // Cursor: only rows whose PK is strictly greater than the last seen cursor.
    // For the first page `after` is 0, which is always less than any real PK.
    where.primaryKeyId = { gt: after };

    // Only reach for raw SQL when a district is genuinely shared.
    //
    // Prisma's `where` cannot express a modulo, so a split district needs raw SQL
    // for its key list, then a second query to load the rows. Running that
    // unconditionally made the common case worse: an unshared district paid two
    // round trips for a filter Prisma can express perfectly well, and the extra key
    // query measured 4.6-5.6s on Thane during verification. Unshared districts now
    // keep the original single-query path exactly as it was.
    const isSplit = partitions.some(p => p.total > 1);
    let pageKeys: number[] | null = null;

    if (isSplit) {
      pageKeys = await this.selectPartitionedPrimaryKeys(partitions, after, since, clampedSize);
      if (pageKeys.length === 0) {
        return { stakeholders: [], nextCursor: null, pageSize: clampedSize, count: 0, partitions };
      }
      // Narrowing to explicit keys already encodes the cursor and the limit, so the
      // pk/limit conditions are dropped to avoid restating them.
      delete where.primaryKeyId;
      where.primaryKeyId = { in: pageKeys };
    } else {
      where.district = { in: partitions.map(p => p.district) };
    }

    // NOTE: full rows on purpose — the mobile mirror (stakeholderDao.upsertMany)
    // persists ~37 of these scalar columns. Do NOT narrow this select; a dropped
    // column disappears from every device's local copy silently.
    const stakeholders = await prisma.stakeholder.findMany({
      where,
      include: {
        _count: { select: { surveys: true } },
      },
      orderBy: { primaryKeyId: 'asc' },
      ...(isSplit ? {} : { take: clampedSize }),
    });

    const rows = stakeholders.map(s => ({
      ...s,
      status: s.status === 'OPEN' && s._count?.surveys > 0 ? 'PARTIAL_COMPLETED' : s.status,
    }));

    // "A full page means keep going" is the contract the mobile loop relies on, and
    // it holds for both paths. On the split path the count comes from the raw key
    // list, which is the authoritative ordered page — a partitioned page is a sparse
    // slice of the id range, so an off-by-one here would skip or repeat rows.
    const pageCount = isSplit ? pageKeys!.length : rows.length;
    const lastKey = isSplit
      ? pageKeys![pageKeys!.length - 1]
      : rows.length > 0 ? rows[rows.length - 1]!.primaryKeyId : undefined;

    const nextCursor = pageCount === clampedSize && lastKey !== undefined
      ? lastKey
      : null; // null signals "no more pages"

    return {
      stakeholders: rows,
      nextCursor,
      pageSize: clampedSize,
      count: rows.length,
      // Echoed so a device (and the verification script) can see which slice it was
      // served, and so an operator reporting "I only got a third of them" has an
      // answer visible in the response rather than needing server logs.
      partitions,
    };
  }

  /**
   * Divide each district's stakeholders between the enumerators assigned to it.
   *
   * WHY
   * Every enumerator in a district used to download that district in full, so with
   * three enumerators the same records were pulled three times and all three saw
   * the same work queue. This assigns each one a disjoint share.
   *
   * HOW — modulo on primaryKeyId
   * For district D with n assigned enumerators, the enumerator at index k receives
   * the rows where `primary_key_id % n = k`. Chosen over the alternatives because:
   *
   *   • It is a true partition: every row satisfies exactly one k, so there is no
   *     duplication AND no gap. A range split (first third, second third...) needs
   *     percentile boundaries that shift as rows are added, and any error there
   *     silently orphans records.
   *   • It is stateless and deterministic, so it holds across the paginated cursor
   *     loop without the server remembering anything between requests.
   *   • Shares come out even, because primaryKeyId is a dense counter from the
   *     import rather than a sparse or clustered key.
   *
   * ORDERING
   * k is the enumerator's position in the member list sorted by id. Sorting in code
   * rather than relying on the database's row order matters: an unordered result
   * could hand the same enumerator a different k on the next page and the download
   * would then mix two slices — duplicating some rows and missing others.
   *
   * WHO COUNTS TOWARD n
   *   • Inactive enumerators are excluded. A deactivated account holding a slice
   *     means nobody downloads it, which is the gap this design exists to avoid.
   *   • Admins are excluded. They bypass district scoping and receive everything
   *     anyway, so counting them would reserve a share no device ever collects.
   *
   * A district with one enumerator gives n=1, k=0, and `% 1 = 0` matches every row
   * — so single-enumerator districts behave exactly as before.
   */
  private async getDistrictPartitions(
    enumeratorId: string,
    districts: string[],
    isAdmin: boolean,
  ): Promise<{ district: string; total: number; index: number }[]> {
    const canonical = await canonicalizeDistricts(districts);
    if (canonical.length === 0) return [];

    // Admins are not field devices; they get the whole of every district they ask
    // for. total=1/index=0 is the identity partition.
    if (isAdmin) {
      return canonical.map(district => ({ district, total: 1, index: 0 }));
    }

    const assignments = await prisma.enumeratorDistrict.findMany({
      where: {
        district: { name: { in: canonical } },
        enumerator: { isActive: true, isAdmin: false },
      },
      select: {
        enumeratorId: true,
        district: { select: { name: true } },
      },
    });

    const membersByDistrict = new Map<string, string[]>();
    for (const a of assignments) {
      const name = a.district?.name;
      if (!name) continue;
      const list = membersByDistrict.get(name);
      if (list) list.push(a.enumeratorId);
      else membersByDistrict.set(name, [a.enumeratorId]);
    }

    return canonical.map(district => {
      // Sort in code so k is stable regardless of how the rows came back.
      const members = (membersByDistrict.get(district) ?? []).slice().sort();
      const index = members.indexOf(enumeratorId);

      if (members.length <= 1) return { district, total: 1, index: 0 };

      if (index === -1) {
        // The caller is scoped to this district but is not in its active
        // non-admin membership — an inactive account, or an assignment removed
        // mid-session. Serve the whole district rather than nothing: an empty work
        // queue looks like data loss to the operator, whereas an extra copy of
        // reference data is harmless. Logged because it means the assignment data
        // and the caller's token disagree.
        logger.warn(
          `[partition] enumerator ${enumeratorId} is scoped to ${district} but not in its active membership (${members.length}); serving the full district`
        );
        return { district, total: 1, index: 0 };
      }

      return { district, total: members.length, index };
    });
  }

  /**
   * Fetch one page of primary keys matching the caller's slice of each district.
   *
   * Raw SQL because the modulo filter has no Prisma equivalent. Every value is
   * bound as a parameter via Prisma.sql, so the district names and the n/k pair
   * cannot be injected even though the OR-branches are assembled dynamically.
   */
  private async selectPartitionedPrimaryKeys(
    partitions: { district: string; total: number; index: number }[],
    after: number,
    since: string | undefined,
    limit: number,
  ): Promise<number[]> {
    const branches = partitions.map(p =>
      p.total <= 1
        // No modulo term at all when the district is not split, so Postgres can use
        // the district index without a residual expression filter.
        ? Prisma.sql`district = ${p.district}`
        : Prisma.sql`(district = ${p.district} AND (primary_key_id % ${p.total}) = ${p.index})`
    );

    // status is a Postgres enum, so the literal needs an explicit cast — an
    // untyped 'OPEN' string fails with "operator does not exist".
    const rows = await prisma.$queryRaw<{ primary_key_id: number }[]>(Prisma.sql`
      SELECT primary_key_id
      FROM stakeholders
      WHERE status = 'OPEN'::"StakeholderStatus"
        AND primary_key_id > ${after}
        ${since ? Prisma.sql`AND updated_at > ${new Date(since)}` : Prisma.empty}
        AND (${Prisma.join(branches, ' OR ')})
      ORDER BY primary_key_id ASC
      LIMIT ${limit}
    `);

    // Number() guards against a driver handing back a string or BigInt for the
    // integer column; the value is used as a cursor and compared numerically.
    return rows.map(r => Number(r.primary_key_id));
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

  /**
   * Create a stakeholder by hand.
   *
   * PRIMARY KEY
   * stakeholders.primary_key_id is a unique Int, populated by the Excel import
   * from the sheet's Primary_Key_ID column — it is not a database sequence, so
   * there is nothing to auto-increment. New rows take MAX+1.
   *
   * That read-then-write is racy: two operators creating at the same moment can
   * both read the same MAX and the second insert then violates the unique
   * constraint. Rather than lock the table, the insert is retried on P2002, which
   * is cheap because the collision window is tiny and the retry re-reads MAX.
   *
   * DISTRICT
   * District is the access-control boundary for enumerators, so a non-admin may
   * only create inside a district they are assigned to. Left unspecified, it
   * defaults to their first assigned district rather than NULL — a district-less
   * row would be invisible to every enumerator (district filters would exclude it)
   * while still counting in totals.
   */
  async createStakeholder(
    data: any,
    enumerator: { id: string; districts: string[]; isAdmin: boolean }
  ) {
    let district = data.district?.trim() || undefined;

    if (district) {
      // Non-admins may only create inside a district they are assigned to.
      if (!enumerator.isAdmin) {
        const allowed = enumerator.districts.some(
          d => d.toUpperCase() === district!.toUpperCase()
        );
        if (!allowed) {
          throw new ForbiddenError(
            `Access denied. You are not assigned to district: ${district}`
          );
        }
      }
    } else {
      // No district supplied — the mobile form does not collect one, since the
      // server decides it. Fall back to the caller's first assigned district for
      // EVERYONE, admins included.
      //
      // This used to fall back only for non-admins, which left an admin creating
      // from the mobile app with district = NULL. A district-less stakeholder is
      // excluded by every district-filtered query (search, the enumerator's own
      // list, dashboard per-district counts) while still counting in totals — so it
      // would exist, be unreachable, and quietly skew the numbers.
      //
      // If there is genuinely no district to fall back on, refuse rather than write
      // the NULL. The admin panel's form has a District field for that case.
      // Consistent with districtGuard, which already refuses an enumerator with no
      // assigned districts on every :id route — such a user cannot open a
      // stakeholder either, so this is not a new restriction. An admin hitting this
      // should use the District field on the admin panel's form.
      if (!enumerator.districts || enumerator.districts.length === 0) {
        throw new ValidationError(
          'No districts assigned, so the district for this stakeholder cannot be ' +
          'determined. Enter a district explicitly, or ask an administrator to ' +
          'assign you one.'
        );
      }
      district = enumerator.districts[0];
    }

    const { district: _ignored, ...rest } = data;

    const MAX_ATTEMPTS = 5;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const highest = await prisma.stakeholder.aggregate({ _max: { primaryKeyId: true } });
      const nextKey = (highest._max.primaryKeyId ?? 0) + attempt;

      try {
        const created = await prisma.stakeholder.create({
          data: {
            ...rest,
            district,
            primaryKeyId: nextKey,
            // Marks provenance so these are distinguishable from imported rows.
            // The import writes 'MCA' or 'Udyam' here.
            dataSource: 'MANUAL',
            status: 'OPEN',
          },
        });

        await prisma.auditLog.create({
          data: {
            action: 'stakeholder_created',
            entityType: 'stakeholder',
            entityId: created.id,
            enumeratorId: enumerator.id,
            details: {
              primaryKeyId: created.primaryKeyId,
              name: created.companyNameStandardized,
              district: created.district,
            },
          },
        });

        broadcastChange(['stakeholders', 'analytics', 'auditLogs'], {
          action: 'create',
          entityId: created.id,
          district: created.district,
        });

        return created;
      } catch (error) {
        // P2002 = unique constraint violation. Only primaryKeyId can realistically
        // collide here, so retry with a fresh MAX. Anything else is a real fault.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          lastError = error;
          logger.warn(
            `primary_key_id ${nextKey} taken, retrying stakeholder create (attempt ${attempt}/${MAX_ATTEMPTS})`
          );
          continue;
        }
        throw error;
      }
    }

    logger.error('Exhausted primary_key_id retries creating stakeholder', lastError);
    throw new ConflictError(
      'Could not allocate an ID for the new stakeholder. Please try again.'
    );
  }

  /**
   * Permanently delete a stakeholder.
   *
   * THIS IS A HARD DELETE, AND WHY
   * The table has no deletedAt/isActive column, and adding one would mean auditing
   * every existing stakeholder query — search, dashboard counts, district
   * aggregates, the paginated mobile sync — to exclude soft-deleted rows. Missing
   * any one of those would leak "deleted" records back into a view. So this
   * removes the row, and recoverability comes from the audit snapshot below rather
   * than from a flag.
   *
   * SURVEYS BLOCK THE DELETE
   * Survey.stakeholder declares no onDelete, so Prisma's default is Restrict and
   * the database would reject this with a raw foreign-key error. A surveyed
   * stakeholder also represents completed field work that should not vanish as a
   * side effect of tidying a list. It is refused explicitly, with an actionable
   * message, instead of surfacing a constraint violation.
   *
   * Phone validations are removed with it: they are derived verification attempts
   * against this record, meaningless once it is gone, and they carry the same
   * Restrict constraint so they would otherwise block the delete too.
   */
  async deleteStakeholder(stakeholderId: string, enumeratorId: string) {
    const stakeholder = await prisma.stakeholder.findUnique({
      where: { id: stakeholderId },
    });

    if (!stakeholder) {
      throw new NotFoundError('Stakeholder');
    }

    const surveyCount = await prisma.survey.count({ where: { stakeholderId } });
    if (surveyCount > 0) {
      throw new ConflictError(
        `This stakeholder has ${surveyCount} survey${surveyCount === 1 ? '' : 's'} attached and cannot be deleted. ` +
        `Delete the survey data first if this record really must be removed.`
      );
    }

    // Snapshot before removal. A hard delete is otherwise unrecoverable, and this
    // is the only trace left of what the row contained.
    await prisma.auditLog.create({
      data: {
        action: 'stakeholder_deleted',
        entityType: 'stakeholder',
        entityId: stakeholderId,
        enumeratorId,
        details: {
          name: stakeholder.companyNameStandardized,
          district: stakeholder.district,
          primaryKeyId: stakeholder.primaryKeyId,
          // Full row, so the record can be reconstructed if this was a mistake.
          snapshot: JSON.parse(JSON.stringify(stakeholder)),
        },
      },
    });

    // One transaction: if the stakeholder delete fails, its phone validations must
    // not already be gone.
    await prisma.$transaction([
      prisma.phoneValidation.deleteMany({ where: { stakeholderId } }),
      prisma.stakeholder.delete({ where: { id: stakeholderId } }),
    ]);

    logger.info(
      `Stakeholder ${stakeholderId} (${stakeholder.companyNameStandardized}) deleted by ${enumeratorId}`
    );

    // analytics included: the totals and per-district counts on the dashboard both
    // move when a row disappears.
    broadcastChange(['stakeholders', 'analytics', 'auditLogs'], {
      action: 'delete',
      entityId: stakeholderId,
      district: stakeholder.district,
    });

    return { id: stakeholderId, deleted: true };
  }
}
