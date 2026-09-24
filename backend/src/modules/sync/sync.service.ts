import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { ValidationError } from '../../utils/errors';
import { getDigiPin } from '../../utils/digipin';
import { districtScopeFilter } from '../../utils/district-scope';
import { broadcastChange } from '../../realtime/events';

const MAX_BATCH_ITEMS = 200;

interface SyncPayload {
  surveys: any[];
  phoneValidations: any[];
  mediaMetadata: any[];
}

export class SyncService {
  /**
   * Process batch upload from offline device.
   * First-to-sync-wins conflict resolution.
   */
  // H1 FIX: accept districts and isAdmin so we can enforce district scope
  async processUpload(enumeratorId: string, payload: SyncPayload, districts: string[], isAdmin: boolean) {
    const results = {
      surveys: { success: 0, failed: 0, errors: [] as string[] },
      phoneValidations: { success: 0, failed: 0, errors: [] as string[] },
      media: { success: 0, failed: 0, errors: [] as string[] },
    };

    // M2 FIX: cap array sizes so a malicious payload can't generate unbounded
    // sequential DB round-trips within the body size limit
    if ((payload.surveys?.length || 0) > MAX_BATCH_ITEMS || (payload.phoneValidations?.length || 0) > MAX_BATCH_ITEMS) {
      throw new ValidationError(`Batch too large. Maximum ${MAX_BATCH_ITEMS} items per array per request.`);
    }

    // PERF: prefetch every referenced stakeholder in a single query instead of
    // one findUnique per item. With a full 200-item batch the old code issued up
    // to 400 sequential lookups (survey loop + phone-validation loop) before any
    // write; this collapses them into one `IN (...)` query feeding an O(1) Map.
    // The select covers the union of fields both loops read (lockedById/status
    // for surveys, district for both).
    const referencedStakeholderIds = [
      ...new Set([
        ...(payload.surveys || []).map((s) => s.stakeholderId),
        ...(payload.phoneValidations || []).map((pv) => pv.stakeholderId),
      ].filter(Boolean)),
    ];
    const stakeholderRows = referencedStakeholderIds.length
      ? await prisma.stakeholder.findMany({
          where: { id: { in: referencedStakeholderIds } },
          select: { id: true, lockedById: true, status: true, district: true },
        })
      : [];
    const stakeholderById = new Map(stakeholderRows.map((s) => [s.id, s]));

    // Process surveys
    for (const surveyData of (payload.surveys || [])) {
      try {
        const stakeholder = stakeholderById.get(surveyData.stakeholderId);

        if (!stakeholder) {
          results.surveys.failed++;
          results.surveys.errors.push(`Stakeholder ${surveyData.stakeholderId}: not found`);
          continue;
        }

        // H1 FIX: enforce district scope — same rule as every other endpoint
        if (!isAdmin) {
          const inDistrict = districts.some(
            (d) => d.toUpperCase() === stakeholder.district?.toUpperCase()
          );
          if (!inDistrict) {
            results.surveys.failed++;
            results.surveys.errors.push(`Stakeholder ${surveyData.stakeholderId}: outside assigned districts`);
            continue;
          }
        }

        if (stakeholder.lockedById && stakeholder.lockedById !== enumeratorId) {
          results.surveys.failed++;
          results.surveys.errors.push(
            `Stakeholder ${surveyData.stakeholderId}: already completed by another enumerator`
          );
          continue;
        }

        let digipin = null;
        if (surveyData.latitude != null && surveyData.longitude != null) {
          try {
            digipin = getDigiPin(surveyData.latitude, surveyData.longitude);
          } catch (e) {}
        }

        await prisma.survey.upsert({
          where: {
            stakeholderId_enumeratorId: {
              stakeholderId: surveyData.stakeholderId,
              enumeratorId,
            },
          },
          update: {
            mobileNumber: surveyData.mobileNumber,
            email: surveyData.email,
            latitude: surveyData.latitude,
            longitude: surveyData.longitude,
            gpsAccuracy: surveyData.gpsAccuracy,
            digipin,
            nearestPoliceStation: surveyData.nearestPoliceStation,
            nearestHealthcareCenter: surveyData.nearestHealthcareCenter,
            businessName: surveyData.businessName,
            ownerName: surveyData.ownerName,
            district: surveyData.district,
            city: surveyData.city,
            pinCode: surveyData.pinCode,
            businessAddress: surveyData.businessAddress,
            aadharNumber: surveyData.aadharNumber,
            udyamAadharRegNo: surveyData.udyamAadharRegNo,
            panNumber: surveyData.panNumber,
            gstNumber: surveyData.gstNumber,
            description: surveyData.description,
            accommodationFacilities: surveyData.accommodationFacilities,
            accommodationPolicies: surveyData.accommodationPolicies,
            workingHours: surveyData.workingHours,
            rooms: surveyData.rooms,
            agreedToTerms: surveyData.agreedToTerms ?? false,
            declaredInfoCorrect: surveyData.declaredInfoCorrect ?? false,
            acknowledgedDotLiability: surveyData.acknowledgedDotLiability ?? false,
            isSynced: true,
            syncedAt: new Date(),
          },
          create: {
            stakeholderId: surveyData.stakeholderId,
            enumeratorId,
            mobileNumber: surveyData.mobileNumber,
            email: surveyData.email,
            latitude: surveyData.latitude,
            longitude: surveyData.longitude,
            gpsAccuracy: surveyData.gpsAccuracy,
            digipin,
            localId: surveyData.localId,
            nearestPoliceStation: surveyData.nearestPoliceStation,
            nearestHealthcareCenter: surveyData.nearestHealthcareCenter,
            businessName: surveyData.businessName,
            ownerName: surveyData.ownerName,
            district: surveyData.district,
            city: surveyData.city,
            pinCode: surveyData.pinCode,
            businessAddress: surveyData.businessAddress,
            aadharNumber: surveyData.aadharNumber,
            udyamAadharRegNo: surveyData.udyamAadharRegNo,
            panNumber: surveyData.panNumber,
            gstNumber: surveyData.gstNumber,
            description: surveyData.description,
            accommodationFacilities: surveyData.accommodationFacilities,
            accommodationPolicies: surveyData.accommodationPolicies,
            workingHours: surveyData.workingHours,
            rooms: surveyData.rooms,
            agreedToTerms: surveyData.agreedToTerms ?? false,
            declaredInfoCorrect: surveyData.declaredInfoCorrect ?? false,
            acknowledgedDotLiability: surveyData.acknowledgedDotLiability ?? false,
            isSynced: true,
            syncedAt: new Date(),
          },
        });

        results.surveys.success++;
      } catch (error: any) {
        results.surveys.failed++;
        results.surveys.errors.push(
          `Survey for ${surveyData.stakeholderId}: ${error.message?.substring(0, 100)}`
        );
      }
    }

    // Process phone validations
    for (const pvData of (payload.phoneValidations || [])) {
      try {
        // X1 FIX: enforce the same district scope as the survey loop above.
        // Without this, a mobile client could write a phone validation for a
        // stakeholder in a district it isn't assigned to.
        // PERF: reuse the batch-prefetched Map instead of a per-item findUnique.
        const stakeholder = stakeholderById.get(pvData.stakeholderId);

        if (!stakeholder) {
          results.phoneValidations.failed++;
          results.phoneValidations.errors.push(`Stakeholder ${pvData.stakeholderId}: not found`);
          continue;
        }

        if (!isAdmin) {
          const inDistrict = districts.some(
            (d) => d.toUpperCase() === stakeholder.district?.toUpperCase()
          );
          if (!inDistrict) {
            results.phoneValidations.failed++;
            results.phoneValidations.errors.push(
              `Stakeholder ${pvData.stakeholderId}: outside assigned districts`
            );
            continue;
          }
        }

        await prisma.phoneValidation.create({
          data: {
            stakeholderId: pvData.stakeholderId,
            enumeratorId,
            phoneNumber: pvData.phoneNumber,
            status: pvData.status,
            method: pvData.method || 'phone_call',
            verifiedAt: pvData.verifiedAt ? new Date(pvData.verifiedAt) : null,
            remarks: pvData.remarks,
            isSynced: true,
            localId: pvData.localId,
          },
        });
        results.phoneValidations.success++;
      } catch (error: any) {
        results.phoneValidations.failed++;
        results.phoneValidations.errors.push(error.message?.substring(0, 100));
      }
    }

    logger.info(`Sync upload processed for enumerator ${enumeratorId}:`, results);

    // A batch upload from a field device is the other way survey data enters the
    // system, and it was entirely silent — an admin watching the dashboard saw
    // nothing until they navigated away and back. Only broadcast when something
    // actually landed, so a no-op sync poll does not churn every client.
    if (results.surveys.success > 0 || results.phoneValidations.success > 0) {
      broadcastChange(['surveys', 'stakeholders', 'analytics', 'exports'], {
        action: 'update',
      });
    }

    return results;
  }

  /**
   * Changes since the device's last pull, for updating its offline mirror.
   *
   * TWO THINGS THIS USED TO GET WRONG
   *
   * 1. It returned only six columns (id, primaryKeyId, status, lockedById,
   *    lockedAt, updatedAt). The mobile mirror persists ~37 scalar columns through
   *    stakeholderDao.upsertMany, which is an INSERT OR REPLACE — so feeding it a
   *    six-column row would have blanked the business name, address and everything
   *    else. The client consequently ignored `updatedStakeholders` altogether and
   *    used only `lockedStakeholderIds`, which is why an edit made in the admin
   *    panel never reached a device: there was no path for it. Full rows are
   *    returned now, and the client applies them.
   *
   * 2. It was scoped by district, not by the caller's partition. A shared district
   *    is divided between its enumerators, so a district-wide delta would have
   *    pushed another enumerator's rows onto this device — undoing the uniqueness
   *    the partition exists to provide, through the back door.
   *
   * `limit` caps a single delta so a device returning after a long absence cannot
   *  pull an unbounded payload; it re-pulls until it is caught up.
   *
   * 3. THE CURSOR COULD SKIP A TRUNCATED PAGE ENTIRELY. `syncTimestamp` was the
   *    server's `now()`, and the client stores that as its next `since`. But rows
   *    are ordered by updated_at and capped at LIMIT, so once a page was truncated
   *    everything beyond it had an updated_at EARLIER than the `now()` the client
   *    was about to filter on — and `updated_at > cursor` could never match it
   *    again. The rows were silently lost, not delayed.
   *
   *    It is not a rare edge case: NOW() in Postgres is the transaction timestamp,
   *    so one claim or one rebalance stamps its whole batch — up to WORK_QUOTA
   *    rows — with a single identical updated_at. A 5000-row claim delivered 2000
   *    and stranded 3000. The device then held work it could not see.
   *
   *    So the cursor is now a keyset: `<iso>|<id>`, and a truncated page resumes at
   *    the exact row it stopped on. That also makes the identical-timestamp case
   *    work, which a timestamp-only cursor fundamentally cannot — with 5000 rows
   *    sharing one value there is no timestamp that both excludes what was sent and
   *    includes what was not.
   *
   *    The cursor stays an opaque string to the client: it only ever stores
   *    `syncTimestamp` and echoes it back as `since`, so a plain ISO string from an
   *    older build is still accepted.
   */
  async getChanges(
    enumeratorId: string,
    districts: string[],
    since?: string,
    isAdmin: boolean = false,
  ) {
    // Taken BEFORE the reads. Handing back `now()` from after them would skip
    // anything written while they ran.
    const queryStart = new Date();

    // `<iso>|<id>` from this endpoint, or a bare ISO string from an older client.
    const sepIndex = since ? since.indexOf('|') : -1;
    const sinceRaw = sepIndex >= 0 ? since!.slice(0, sepIndex) : since;
    const sinceId = sepIndex >= 0 ? since!.slice(sepIndex + 1) : null;

    const parsed = sinceRaw ? new Date(sinceRaw) : null;
    // A malformed cursor must not become `Invalid Date` and match nothing, which
    // would freeze the device's mirror permanently with no error anywhere.
    const sinceDate = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(0);

    const LIMIT = 2000;

    // Revocations are a list of bare ids, not full rows, so a far larger page costs
    // little. It is deliberately above WORK_QUOTA: a single release stamps its whole
    // batch with one revoked_at, and a page that split such a batch would hit the
    // same unsplittable-timestamp problem described above.
    const REVOCATION_LIMIT = 20_000;

    // Scoped to this enumerator's claimed work. Was a modulo slice of the district,
    // which needed raw SQL; a stored claim is an indexed column.
    //
    // Note this deliberately does NOT filter on status: a device needs to hear that
    // one of its stakeholders became CLOSED just as much as an edit, otherwise it
    // keeps offering work that is already done.
    // Keyset predicate: strictly later, OR the same instant but a later id. The
    // second half is what lets a page split a block of rows that all share one
    // updated_at and still resume correctly.
    const cursorFilter: Prisma.StakeholderWhereInput = sinceId
      ? {
          OR: [
            { updatedAt: { gt: sinceDate } },
            { updatedAt: sinceDate, id: { gt: sinceId } },
          ],
        }
      : { updatedAt: { gt: sinceDate } };

    const where: Prisma.StakeholderWhereInput = { ...cursorFilter };

    if (isAdmin) {
      // An admin holds no claims, so scoping by assignment would return nothing.
      Object.assign(where, await districtScopeFilter(districts));
    } else {
      where.assignedToId = enumeratorId;
    }

    // FULL rows on purpose — see note 1 above. Do NOT narrow this select.
    //
    // Ordered by (updated_at, id) to match the keyset above. Ordering by updated_at
    // alone leaves rows sharing a timestamp in an arbitrary order, so a truncated
    // page could cut the block at a different point each time and skip rows.
    const rows = await prisma.stakeholder.findMany({
      where,
      include: { _count: { select: { surveys: true } } },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: LIMIT,
    });

    // Same status derivation the download feeds use. Without it the delta would
    // hand back a plain 'OPEN' for a stakeholder that already has a survey against
    // it, overwriting the local 'PARTIAL_COMPLETED' and making a part-finished
    // record look untouched again.
    const updatedStakeholders = rows.map(s => ({
      ...s,
      status: s.status === 'OPEN' && s._count?.surveys > 0 ? 'PARTIAL_COMPLETED' : s.status,
    }));

    // Rows this device must drop: taken by someone else, or finished. Sent
    // separately because removing them locally is a different operation from
    // upserting an edit, and the client protects unsynced work when it purges.
    const lockedByOthers = updatedStakeholders.filter(
      s => s.status === 'CLOSED' || (s.lockedById && s.lockedById !== enumeratorId)
    );

    // Claims taken back from this device — a colleague's share was rebalanced, or a
    // district was reassigned. These CANNOT be found in the query above: it locates
    // work by `assigned_to_id = me`, and a released row no longer matches, so it
    // drops out of the feed the instant it is released and would otherwise stay on
    // the device forever, offered as work someone else now owns.
    //
    // Admins hold no claims, so they have no revocations to receive.
    const revoked = isAdmin
      ? []
      : await prisma.stakeholderRevocation.findMany({
          where: { enumeratorId, revokedAt: { gt: sinceDate } },
          select: { stakeholderId: true, revokedAt: true },
          orderBy: { revokedAt: 'asc' },
          take: REVOCATION_LIMIT,
        });

    // A revocation says "you no longer hold this". It does NOT say "delete this",
    // and the difference matters because a released row is very often claimed again
    // later — `releaseOverShare` runs on a routine top-up, and a rebalance hands the
    // freed rows straight back out, sometimes to the same enumerator.
    //
    // Without this check the feed would order a device to destroy work it currently
    // owns. A device with no cursor (fresh install, reinstall, or re-login after the
    // logout wipe) reads `since` as the epoch and therefore receives EVERY
    // revocation ever recorded against it — including ones for rows it has since
    // re-claimed. Those rows arrive in `updatedStakeholders` too, and the client
    // upserts before it purges, so the row would be written and then deleted. The
    // stakeholder stays assigned server-side while vanishing from the device, and
    // the delta only reports `updated_at > cursor`, so nothing brings it back.
    //
    // Checking current ownership instead of trying to keep the revocation log
    // perfectly pruned means a stale or replayed revocation is simply inert.
    const revokedIds = revoked.map(r => r.stakeholderId);
    let stillHeld = new Set<string>();
    if (revokedIds.length > 0) {
      const held = await prisma.stakeholder.findMany({
        where: { id: { in: revokedIds }, assignedToId: enumeratorId },
        select: { id: true },
      });
      stillHeld = new Set(held.map(h => h.id));
    }

    // One list, because the client applies the same safe purge to all of it:
    // anything still holding unsynced survey or media rows is skipped and retried
    // after those uploads land.
    const dropIds = Array.from(new Set([
      ...lockedByOthers.map(s => s.id),
      ...revokedIds.filter(id => !stillHeld.has(id)),
    ]));

    const truncated = rows.length >= LIMIT;
    const lastRow = rows[rows.length - 1];
    const revocationsTruncated = revoked.length >= REVOCATION_LIMIT;
    const lastRevocation = revoked[revoked.length - 1];

    // The cursor has to be the EARLIEST point either list still needs, because one
    // value drives both. Advancing to satisfy the stakeholder page while the
    // revocation page was cut short would step over revocations that were never
    // delivered; re-sending a few stakeholder rows is free by comparison, since the
    // client's upsert is idempotent.
    let nextCursor: string;
    if (revocationsTruncated && lastRevocation) {
      nextCursor = lastRevocation.revokedAt.toISOString();
    } else if (truncated && lastRow) {
      // Resume at the exact row this page stopped on, so nothing between it and
      // `now` is skipped.
      nextCursor = `${lastRow.updatedAt.toISOString()}|${lastRow.id}`;
    } else {
      // Both lists complete. `queryStart` is from BEFORE the reads, so anything
      // written while they ran is picked up next time rather than missed.
      nextCursor = queryStart.toISOString();
    }

    return {
      updatedStakeholders,
      lockedStakeholderIds: dropIds,
      // Tells the client to pull again immediately rather than waiting for the
      // next trigger, so a long-absent device catches up in a few round trips.
      hasMore: truncated || revocationsTruncated,
      syncTimestamp: nextCursor,
    };
  }
}
