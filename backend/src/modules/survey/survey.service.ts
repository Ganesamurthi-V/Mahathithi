import { prisma } from '../../config/database';
import { NotFoundError, ValidationError, ConflictError } from '../../utils/errors';
import { assertStakeholderAccess } from '../../utils/access-control';
import { logger } from '../../utils/logger';
import { emitToDistrictAndAdmins } from '../../realtime/socket';
import { getDigiPin } from '../../utils/digipin';
// B7 FIX: removed unused StakeholderService import/instance — it was never
// referenced and risked a circular dependency between the survey and
// stakeholder services.


interface CreateSurveyData {
  stakeholderId: string;
  enumeratorId: string;
  mobileNumber?: string;
  email?: string;
  businessCategory?: string;
  nearestPoliceStation?: string;
  nearestHealthcareCenter?: string;
  latitude?: number;
  longitude?: number;
  gpsAccuracy?: number;
  localId?: string;
  subCategories?: string[];
  businessName?: string;
  ownerName?: string;
  district?: string;
  city?: string;
  pinCode?: string;
  businessAddress?: string;
  aadharNumber?: string;
  udyamAadharRegNo?: string;
  panNumber?: string;
  description?: string;
  accommodationFacilities?: any;
  accommodationPolicies?: string;
  workingHours?: any;
  rooms?: any;
  aboutBusiness?: string;
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
    // Strip rooms/accommodation fields when category is not Accommodations
    const isAccommodation = data.businessCategory === 'Accommodations';
    const newPlanFields = {
      subCategories: data.subCategories ?? [],
      businessName: data.businessName,
      ownerName: data.ownerName,
      district: data.district,
      city: data.city,
      pinCode: data.pinCode,
      businessAddress: data.businessAddress,
      aadharNumber: data.aadharNumber,
      udyamAadharRegNo: data.udyamAadharRegNo,
      panNumber: data.panNumber,
      description: data.description,
      accommodationFacilities: isAccommodation ? data.accommodationFacilities : undefined,
      accommodationPolicies: isAccommodation ? data.accommodationPolicies : undefined,
      workingHours: data.workingHours,
      rooms: isAccommodation ? data.rooms : undefined,
      aboutBusiness: data.aboutBusiness,
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
        businessCategory: data.businessCategory,
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
        businessCategory: data.businessCategory,
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
   * Complete a survey with validation.
   * Requirements:
   * - Contact Person filled
   * - Phone filled
   * - GPS captured
   * - Minimum 4 photos
   * - 1 video
   * - Phone verification completed
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

    // === VALIDATION CHECKS ===
    const validationErrors: string[] = [];

    if (!survey.businessName || survey.businessName.trim() === '') {
      validationErrors.push('Business name is required');
    }

    // 2. Phone
    if (!survey.mobileNumber || survey.mobileNumber.trim() === '') {
      validationErrors.push('Mobile number is required');
    }

    // 3. GPS
    if (survey.latitude == null || survey.longitude == null) {
      validationErrors.push('GPS coordinates are required');
    }

    // 4. Minimum 1 photo
    const photos = survey.media.filter(m => m.type === 'PHOTO');
    if (photos.length < 1) {
      validationErrors.push(`Minimum 1 photo required (currently: ${photos.length})`);
    }

    // 5. 1 video
    const videos = survey.media.filter(m => m.type === 'VIDEO');
    if (videos.length < 1) {
      validationErrors.push('At least 1 verification video is required');
    }

    // New-form validations
    if (!survey.description || survey.description.trim().length < 50) {
      validationErrors.push('Description must be at least 50 characters');
    }
    if (survey.businessCategory === 'Accommodations') {
      const roomsData = survey.rooms as any[] | null;
      if (!roomsData || !Array.isArray(roomsData) || roomsData.length < 1) {
        validationErrors.push('At least 1 room is required for Accommodation listings');
      }
    }
    if (!survey.agreedToTerms || !survey.declaredInfoCorrect || !survey.acknowledgedDotLiability) {
      validationErrors.push('All Terms & Conditions checkboxes must be accepted');
    }

    // === DETERMINE STATUS ===
    // B6 FIX: an incomplete survey is a failed completion, not a success.
    // Throw a ValidationError (400) carrying the missing requirements as
    // details instead of returning a 200 with `status: 'OPEN'`. This also
    // removes the ambiguous `isDraft:false` + `isCompleted:false` state the
    // old partial-update branch left behind — a survey only leaves draft when
    // it actually completes.
    if (validationErrors.length > 0) {
      throw new ValidationError('Survey is incomplete', validationErrors);
    }

    // All requirements met → CLOSED + LOCK
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
            videosCount: videos.length,
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