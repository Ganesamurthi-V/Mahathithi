import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';

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
  async processUpload(enumeratorId: string, payload: SyncPayload) {
    const results = {
      surveys: { success: 0, failed: 0, errors: [] as string[] },
      phoneValidations: { success: 0, failed: 0, errors: [] as string[] },
      media: { success: 0, failed: 0, errors: [] as string[] },
    };

    // Process surveys
    for (const surveyData of (payload.surveys || [])) {
      try {
        // Check if stakeholder is already locked by another enumerator
        const stakeholder = await prisma.stakeholder.findUnique({
          where: { id: surveyData.stakeholderId },
          select: { lockedById: true, status: true },
        });

        if (stakeholder?.lockedById && stakeholder.lockedById !== enumeratorId) {
          results.surveys.failed++;
          results.surveys.errors.push(
            `Stakeholder ${surveyData.stakeholderId}: already completed by another enumerator`
          );
          continue;
        }

        await prisma.survey.upsert({
          where: {
            stakeholderId_enumeratorId: {
              stakeholderId: surveyData.stakeholderId,
              enumeratorId,
            },
          },
          update: {
            contactPerson: surveyData.contactPerson,
            designation: surveyData.designation,
            mobileNumber: surveyData.mobileNumber,
            email: surveyData.email,
            website: surveyData.website,
            businessCategory: surveyData.businessCategory,
            notes: surveyData.notes,
            gstNumber: surveyData.gstNumber,
            organizationType: surveyData.organizationType,
            remarks: surveyData.remarks,
            latitude: surveyData.latitude,
            longitude: surveyData.longitude,
            gpsAccuracy: surveyData.gpsAccuracy,
            isSynced: true,
            syncedAt: new Date(),
          },
          create: {
            stakeholderId: surveyData.stakeholderId,
            enumeratorId,
            contactPerson: surveyData.contactPerson,
            designation: surveyData.designation,
            mobileNumber: surveyData.mobileNumber,
            email: surveyData.email,
            website: surveyData.website,
            businessCategory: surveyData.businessCategory,
            notes: surveyData.notes,
            gstNumber: surveyData.gstNumber,
            organizationType: surveyData.organizationType,
            remarks: surveyData.remarks,
            latitude: surveyData.latitude,
            longitude: surveyData.longitude,
            gpsAccuracy: surveyData.gpsAccuracy,
            localId: surveyData.localId,
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
        district: { in: districts, mode: 'insensitive' },
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

    // Separate into locked (by others) and updated
    const lockedByOthers = updatedStakeholders.filter(
      s => s.lockedById && s.lockedById !== enumeratorId && s.status === 'CLOSED'
    );

    return {
      updatedStakeholders,
      lockedStakeholderIds: lockedByOthers.map(s => s.id),
      syncTimestamp: new Date().toISOString(),
    };
  }
}
