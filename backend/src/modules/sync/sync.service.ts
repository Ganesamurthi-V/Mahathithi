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
            businessCategory: surveyData.businessCategory,
            latitude: surveyData.latitude,
            longitude: surveyData.longitude,
            gpsAccuracy: surveyData.gpsAccuracy,
            digipin,
            nearestPoliceStation: surveyData.nearestPoliceStation,
            nearestHealthcareCenter: surveyData.nearestHealthcareCenter,
            subCategories: surveyData.subCategories ?? [],
            businessName: surveyData.businessName,
            ownerName: surveyData.ownerName,
            district: surveyData.district,
            city: surveyData.city,
            pinCode: surveyData.pinCode,
            businessAddress: surveyData.businessAddress,
            aadharNumber: surveyData.aadharNumber,
            udyamAadharRegNo: surveyData.udyamAadharRegNo,
            panNumber: surveyData.panNumber,
            description: surveyData.description,
            accommodationFacilities: surveyData.accommodationFacilities,
            accommodationPolicies: surveyData.accommodationPolicies,
            workingHours: surveyData.workingHours,
            rooms: surveyData.rooms,
            aboutBusiness: surveyData.aboutBusiness,
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
            businessCategory: surveyData.businessCategory,
            latitude: surveyData.latitude,
            longitude: surveyData.longitude,
            gpsAccuracy: surveyData.gpsAccuracy,
            digipin,
            localId: surveyData.localId,
            nearestPoliceStation: surveyData.nearestPoliceStation,
            nearestHealthcareCenter: surveyData.nearestHealthcareCenter,
            subCategories: surveyData.subCategories ?? [],
            businessName: surveyData.businessName,
            ownerName: surveyData.ownerName,
            district: surveyData.district,
            city: surveyData.city,
            pinCode: surveyData.pinCode,
            businessAddress: surveyData.businessAddress,
            aadharNumber: surveyData.aadharNumber,
            udyamAadharRegNo: surveyData.udyamAadharRegNo,
            panNumber: surveyData.panNumber,
            description: surveyData.description,
            accommodationFacilities: surveyData.accommodationFacilities,
            accommodationPolicies: surveyData.accommodationPolicies,
            workingHours: surveyData.workingHours,
            rooms: surveyData.rooms,
            aboutBusiness: surveyData.aboutBusiness,
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
   * Get changes since last sync for offline device update
   */
  async getChanges(enumeratorId: string, districts: string[], since?: string) {
    const sinceDate = since ? new Date(since) : new Date(0);

    // Get stakeholders that were locked/updated since last sync
    const updatedStakeholders = await prisma.stakeholder.findMany({
      where: {
        // PERF: exact match so the (district, updated_at) index path is usable.
        ...(await districtScopeFilter(districts)),
        updatedAt: { gt: sinceDate },
      },
      select: {
        id: true,
        primaryKeyId: true,
        status: true,
        lockedById: true,
        lockedAt: true,
        updatedAt: true,
      },
    });

    // Separate into locked (by others) and completed
    const lockedByOthers = updatedStakeholders.filter(
      s => s.status === 'CLOSED' || (s.lockedById && s.lockedById !== enumeratorId)
    );

    return {
      updatedStakeholders,
      lockedStakeholderIds: lockedByOthers.map(s => s.id),
      syncTimestamp: new Date().toISOString(),
    };
  }
}
