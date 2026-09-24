import { prisma } from '../../config/database';
import { NotFoundError, ConflictError } from '../../utils/errors';
import { assertStakeholderAccess } from '../../utils/access-control';
import { logger } from '../../utils/logger';
import { emitToDistrictAndAdmins } from '../../realtime/socket';
import { broadcastChange } from '../../realtime/events';
import { getDigiPin } from '../../utils/digipin';
// B7 FIX: removed unused StakeholderService import/instance — it was never
// referenced and risked a circular dependency between the survey and
// stakeholder services.


interface CreateSurveyData {
  stakeholderId: string;
  enumeratorId: string;
  mobileNumber?: string;
  email?: string;
  nearestPoliceStation?: string;
  nearestHealthcareCenter?: string;
  latitude?: number;
  longitude?: number;
  gpsAccuracy?: number;
  localId?: string;
  businessName?: string;
  ownerName?: string;
  district?: string;
  city?: string;
  pinCode?: string;
  businessAddress?: string;
  aadharNumber?: string;
  udyamAadharRegNo?: string;
  panNumber?: string;
  gstNumber?: string;
  description?: string;
  accommodationFacilities?: any;
  accommodationPolicies?: string;
  workingHours?: any;
  rooms?: any;
  agreedToTerms?: boolean;
  declaredInfoCorrect?: boolean;
  acknowledgedDotLiability?: boolean;
}

export class SurveyService {
  /**
   * Create or update a survey for a stakeholder
   */
  // C2 FIX: accept caller's districts and admin flag so we can enforce district isolation
  async createOrUpdate(data: CreateSurveyData, enumeratorDistricts: string[], isAdmin: boolean) {
    // Check if stakeholder exists and is accessible
    const stakeholder = await prisma.stakeholder.findUnique({
      where: { id: data.stakeholderId },
    });

    if (!stakeholder) {
      throw new NotFoundError('Stakeholder');
    }

    // C2 FIX: enforce district-based access before any write
    assertStakeholderAccess(stakeholder, enumeratorDistricts, isAdmin);

    // Check if locked by another enumerator
    if (stakeholder.lockedById && stakeholder.lockedById !== data.enumeratorId) {
      throw new ConflictError('This stakeholder has been completed by another enumerator');
    }

    let digipin = null;
    if (data.latitude != null && data.longitude != null) {
      try {
        digipin = getDigiPin(data.latitude, data.longitude);
      } catch (e) {}
    }

    // ─── Build new-plan fields payload ───────────────────────────────────────
    // The Category step was removed, so there is no longer anything to branch on:
    // the accommodation and rooms fields are always saved as sent.
    const newPlanFields = {
      businessName: data.businessName,
      ownerName: data.ownerName,
      district: data.district,
      city: data.city,
      pinCode: data.pinCode,
      businessAddress: data.businessAddress,
      aadharNumber: data.aadharNumber,
      udyamAadharRegNo: data.udyamAadharRegNo,
      panNumber: data.panNumber,
      gstNumber: data.gstNumber,
      description: data.description,
      accommodationFacilities: data.accommodationFacilities,
      accommodationPolicies: data.accommodationPolicies,
      workingHours: data.workingHours,
      rooms: data.rooms,
      agreedToTerms: data.agreedToTerms ?? false,
      declaredInfoCorrect: data.declaredInfoCorrect ?? false,
      acknowledgedDotLiability: data.acknowledgedDotLiability ?? false,
    };

    // Upsert survey (one survey per stakeholder per enumerator)
    const survey = await prisma.survey.upsert({
      where: {
        stakeholderId_enumeratorId: {
          stakeholderId: data.stakeholderId,
          enumeratorId: data.enumeratorId,
        },
      },
      update: {
        mobileNumber: data.mobileNumber,
        email: data.email,
        nearestPoliceStation: data.nearestPoliceStation,
        nearestHealthcareCenter: data.nearestHealthcareCenter,
        latitude: data.latitude,
        longitude: data.longitude,
        gpsAccuracy: data.gpsAccuracy,
        digipin,
        ...newPlanFields,
        isDraft: true,
      },
      create: {
        stakeholderId: data.stakeholderId,
        enumeratorId: data.enumeratorId,
        mobileNumber: data.mobileNumber,
        email: data.email,
        nearestPoliceStation: data.nearestPoliceStation,
        nearestHealthcareCenter: data.nearestHealthcareCenter,
        latitude: data.latitude,
        longitude: data.longitude,
        gpsAccuracy: data.gpsAccuracy,
        digipin,
        ...newPlanFields,
        localId: data.localId,
        isDraft: true,
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'survey_saved',
        entityType: 'survey',
        entityId: survey.id,
        enumeratorId: data.enumeratorId,
        details: { stakeholderId: data.stakeholderId, isDraft: true },
      },
    });

    return survey;
  }

  /**
   * Get survey for a stakeholder
   */
  // C2 FIX: enforce district-based access on read path too
  // B2 FIX: scope to the calling enumerator so one enumerator can never read
  // another enumerator's draft survey (PII leak) for the same stakeholder.
  async getByStakeholderId(
    stakeholderId: string,
    enumeratorId: string,
    enumeratorDistricts: string[],
    isAdmin: boolean
  ) {
    // Load the stakeholder first so we can check district access
    const stakeholder = await prisma.stakeholder.findUnique({ where: { id: stakeholderId } });
    if (!stakeholder) throw new NotFoundError('Stakeholder');
    assertStakeholderAccess(stakeholder, enumeratorDistricts, isAdmin);

    const survey = await prisma.survey.findFirst({
      where: {
        stakeholderId,
        // B2 FIX: only return the caller's own survey for this stakeholder, unless admin
        ...(isAdmin ? {} : { enumeratorId }),
      },
      include: {
        // NEW-1 FIX: don't surface tombstoned media in survey detail
        media: { where: { deletedAt: null } },
        stakeholder: {
          select: {
            companyNameStandardized: true,
            district: true,
            status: true,
          },
        },
      },
    });

    // B9 FIX: return a clean 404 instead of a 200 with `data: null`, which
    // crashes clients that dereference the survey object.
    if (!survey) {
      throw new NotFoundError('Survey');
    }

    return survey;
  }

  /**
   * Complete a survey.
   *
   * There are NO completeness requirements — no required fields, no minimum photo
   * count, no minimum description length, no mandatory terms. Whatever the
   * enumerator submitted is accepted, marked completed, and the stakeholder is
   * closed and locked to them.
   *
   * Still enforced: district isolation (assertStakeholderAccess) and ownership
   * (an enumerator may only complete their own survey).
   */
  async completeSurvey(
    surveyId: string,
    enumeratorId: string,
    // B1 FIX: thread the caller's districts and admin flag so the highest-
    // privilege write in the system enforces the same district isolation as
    // every other stakeholder-scoped endpoint.
    enumeratorDistricts: string[],
    isAdmin: boolean
  ) {
    const survey = await prisma.survey.findUnique({
      where: { id: surveyId },
      include: {
        media: {
          where: { deletedAt: null }
        },
        stakeholder: {
          include: {
            phoneValidations: {
              where: { enumeratorId }
            },
          },
        },
      },
    });

    if (!survey) {
      throw new NotFoundError('Survey');
    }

    // B1 FIX: district check must come before the ownership check.
    assertStakeholderAccess(survey.stakeholder, enumeratorDistricts, isAdmin);

    if (survey.enumeratorId !== enumeratorId) {
      throw new ConflictError('You can only complete your own surveys');
    }

    // === NO COMPLETENESS VALIDATION ===
    // Every field, photo and acknowledgement on the survey form is optional by
    // request, so completing a survey never fails for missing data. A submission
    // that reaches here is accepted as-is. Access and ownership are still enforced
    // above (district isolation + "you can only complete your own surveys"); only
    // the completeness rules were removed.
    const photos = survey.media.filter(m => m.type === 'PHOTO');

    // Accepted → CLOSED + LOCK
    await prisma.$transaction([
      prisma.survey.update({
        where: { id: surveyId },
        data: {
          isDraft: false,
          isCompleted: true,
          completedAt: new Date(),
        },
      }),
      prisma.stakeholder.update({
        where: { id: survey.stakeholderId },
        data: {
          status: 'CLOSED',
          lockedById: enumeratorId,
          lockedAt: new Date(),
        },
      }),
      prisma.auditLog.create({
        data: {
          action: 'survey_completed',
          entityType: 'survey',
          entityId: surveyId,
          enumeratorId,
          details: {
            stakeholderId: survey.stakeholderId,
            photosCount: photos.length,
          },
        },
      }),
    ]);

    logger.info(`Survey completed: ${surveyId}, stakeholder locked by ${enumeratorId}`);

    // REALTIME: notify the district's other enumerators + all admins
    emitToDistrictAndAdmins(survey.stakeholder.district, 'stakeholder:locked', {
      stakeholderId: survey.stakeholderId,
      lockedById: enumeratorId,
      lockedAt: new Date().toISOString(),
      district: survey.stakeholder.district,
    });

    // A completed survey is the single most consequential change in the system:
    // it moves the completed/closed counters, adds a row to the export queue, and
    // flips the stakeholder's status everywhere. Broadcasting the affected
    // resources means an admin watching the dashboard or the export page sees it
    // land without touching anything.
    broadcastChange(
      ['surveys', 'stakeholders', 'analytics', 'exports', 'auditLogs'],
      { action: 'update', entityId: surveyId, district: survey.stakeholder.district }
    );

    return {
      status: 'CLOSED',
      message: 'Survey completed successfully. Stakeholder has been closed and locked.',
    };
  }

  /**
   * Get surveys by enumerator
   */
  async getByEnumerator(enumeratorId: string) {
    return prisma.survey.findMany({
      where: { enumeratorId },
      include: {
        stakeholder: {
          select: {
            companyNameStandardized: true,
            district: true,
            city: true,
            status: true,
          },
        },
        media: {
          // NEW-1 FIX: exclude tombstoned media from per-survey listings
          where: { deletedAt: null },
          select: { id: true, type: true, photoCategory: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }
}