import { prisma } from '../../config/database';
import { NotFoundError, ConflictError, ValidationError } from '../../utils/errors';
import { assertStakeholderAccess } from '../../utils/access-control';
import { logger } from '../../utils/logger';
import { emitToDistrictAndAdmins } from '../../realtime/socket';
import { broadcastChange } from '../../realtime/events';
import { getDigiPin } from '../../utils/digipin';
// B7 FIX: removed unused StakeholderService import/instance — it was never
// referenced and risked a circular dependency between the survey and
// stakeholder services.


// Server-side format rules for admin survey edits. Mirrors the inline validation
// in the admin panel so a malformed value is rejected even if it bypasses the UI
// (a client-side rule is advice, not a constraint — the endpoint is reachable
// directly). Each rule runs ONLY on a non-empty value: these fields are optional,
// so blank is allowed; we reject only wrongly-formatted input.
const SURVEY_FORMAT_RULES: Record<string, { test: (v: string) => boolean; message: string }> = {
  mobileNumber: {
    test: (v) => /^(?:\+91[-\s]?|0)?[6-9]\d{9}$/.test(v.replace(/\s+/g, '')),
    message: 'Mobile number must be a valid 10-digit Indian number',
  },
  email: {
    test: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    message: 'Email address is not valid',
  },
  pinCode: {
    test: (v) => /^[1-9]\d{5}$/.test(v),
    message: 'PIN code must be 6 digits',
  },
  aadharNumber: {
    test: (v) => /^\d{12}$/.test(v),
    message: 'Aadhar number must be exactly 12 digits',
  },
  panNumber: {
    test: (v) => /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/.test(v),
    message: 'PAN must be 10 characters, e.g. ABCDE1234F',
  },
  gstNumber: {
    test: (v) => /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][0-9A-Za-z]Z[0-9A-Za-z]$/.test(v),
    message: 'GST number must be a valid 15-character GSTIN',
  },
};

function validateSurveyFormats(data: Record<string, any>): string[] {
  const errors: string[] = [];
  for (const [field, rule] of Object.entries(SURVEY_FORMAT_RULES)) {
    const raw = data[field];
    if (raw === undefined || raw === null) continue;
    const v = raw.toString().trim();
    if (v === '') continue; // optional — blank allowed
    if (!rule.test(v)) errors.push(rule.message);
  }
  return errors;
}

interface CreateSurveyData {
  stakeholderId: string;
  enumeratorId: string;
  mobileNumber?: string;
  telephoneNumber?: string;
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
        telephoneNumber: data.telephoneNumber,
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
        telephoneNumber: data.telephoneNumber,
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
        enumerator: {
          select: {
            name: true,
            loginId: true,
          },
        },
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

    const hasIdentityNumber = Boolean(
      (survey.aadharNumber && survey.aadharNumber.trim() !== '') ||
      (survey.udyamAadharRegNo && survey.udyamAadharRegNo.trim() !== '')
    );

    const newStakeholderStatus = hasIdentityNumber ? 'CLOSED' : 'OPEN';
    const newIsCompleted = hasIdentityNumber;

    // Accepted → CLOSED + LOCK (if fully complete)
    await prisma.$transaction([
      prisma.survey.update({
        where: { id: surveyId },
        data: {
          isDraft: false,
          isCompleted: newIsCompleted,
          completedAt: new Date(),
        },
      }),
      prisma.stakeholder.update({
        where: { id: survey.stakeholderId },
        data: {
          status: newStakeholderStatus as any,
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
      status: newStakeholderStatus,
      message: newStakeholderStatus === 'CLOSED'
        ? 'Survey completed successfully. Stakeholder has been closed and locked.'
        : 'Survey submitted successfully, but missing identity number. Marked as partially completed.',
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

  /**
   * ADMIN: Take survey for an OPEN stakeholder directly from the admin panel.
   * Creates a new draft survey initialized with some basic data from the stakeholder.
   */
  async adminCreateSurvey(stakeholderId: string, adminId: string) {
    const stakeholder = await prisma.stakeholder.findUnique({
      where: { id: stakeholderId },
      include: { surveys: true }
    });
    if (!stakeholder) throw new NotFoundError('Stakeholder');

    if (stakeholder.status !== 'OPEN') {
      throw new ConflictError('Can only take a survey for OPEN stakeholders.');
    }

    if (stakeholder.surveys && stakeholder.surveys.length > 0) {
      throw new ConflictError('A survey already exists for this stakeholder.');
    }

    let digipin = stakeholder.digipin;
    if (!digipin && stakeholder.latitude && stakeholder.longitude) {
      try { digipin = getDigiPin(stakeholder.latitude, stakeholder.longitude) || digipin; } catch(e) {}
    }

    const survey = await prisma.survey.create({
      data: {
        stakeholderId,
        enumeratorId: adminId,
        businessName: stakeholder.companyNameOriginal || '',
        businessCategory: stakeholder.category || '',
        latitude: stakeholder.latitude,
        longitude: stakeholder.longitude,
        digipin,
        isDraft: true,
        isCompleted: false,
        businessAddress: stakeholder.addressLine1 || stakeholder.fullAddressRaw || '',
        district: stakeholder.district || '',
        city: stakeholder.city || stakeholder.taluka || stakeholder.village || '',
        gstNumber: stakeholder.gstNumber || '',
      }
    });

    broadcastChange(['surveys', 'stakeholders'], { action: 'create', entityId: survey.id });

    return survey;
  }

  /**
   * ADMIN: edit a survey's fields.
   *
   * For the admin verification workflow: a partially-completed (draft) survey the
   * mobile enumerator uploaded can be opened by an admin, who fills in / corrects
   * missing details before finalizing it. Unlike createOrUpdate this is NOT scoped
   * to an owning enumerator (admins verify everyone's work) and it does NOT touch
   * isDraft / isCompleted / stakeholder status — editing never finalizes. Only
   * adminFinalizeSurvey (or the mobile complete()) closes a survey.
   *
   * Only known survey columns are written; any other keys are ignored so a stray
   * field from the client can never reach Prisma.
   */
  async adminEditSurvey(surveyId: string, fields: Partial<CreateSurveyData>) {
    const existing = await prisma.survey.findUnique({ where: { id: surveyId } });
    if (!existing) throw new NotFoundError('Survey');

    // Whitelist the editable columns. Recompute digipin if coordinates change.
    const data: any = {};
    const allowed: (keyof CreateSurveyData)[] = [
      'mobileNumber', 'telephoneNumber', 'email', 'nearestPoliceStation', 'nearestHealthcareCenter',
      'latitude', 'longitude', 'gpsAccuracy',
      'businessName', 'ownerName', 'district', 'city', 'pinCode', 'businessAddress',
      'aadharNumber', 'udyamAadharRegNo', 'panNumber', 'gstNumber',
      'description', 'accommodationFacilities', 'accommodationPolicies',
      'workingHours', 'rooms',
      'agreedToTerms', 'declaredInfoCorrect', 'acknowledgedDotLiability',
    ];
    for (const key of allowed) {
      if (fields[key] !== undefined) data[key] = fields[key];
    }

    // Reject malformed values (mobile, email, PIN, Aadhaar, PAN, GST) before the
    // write. Mirrors the admin panel's inline validation so the guarantee holds
    // even for a request that skipped the UI.
    const formatErrors = validateSurveyFormats(data);
    if (formatErrors.length > 0) {
      throw new ValidationError('Some fields are not in the correct format', formatErrors);
    }

    if (data.latitude != null && data.longitude != null) {
      try {
        data.digipin = getDigiPin(data.latitude, data.longitude);
      } catch (e) { /* leave digipin untouched if computation fails */ }
    }

    const survey = await prisma.survey.update({ where: { id: surveyId }, data });

    await prisma.auditLog.create({
      data: {
        action: 'survey_admin_edited',
        entityType: 'survey',
        entityId: surveyId,
        enumeratorId: existing.enumeratorId,
        details: { stakeholderId: existing.stakeholderId, editedFields: Object.keys(data) },
      },
    });

    // Admins watching the detail view / list see the edit land live.
    broadcastChange(['surveys', 'stakeholders'], { action: 'update', entityId: surveyId });

    return survey;
  }

  /**
   * ADMIN: finalize (complete) a survey.
   *
   * Same terminal transition as the mobile completeSurvey — survey becomes
   * isDraft:false / isCompleted:true and the stakeholder is set CLOSED + locked —
   * but reached from the admin verification flow instead of the field device.
   *
   * Two deliberate differences from completeSurvey():
   *   - NO ownership check. An admin finalizes any enumerator's survey; that is the
   *     whole point of the verification step.
   *   - The stakeholder is locked to the survey's OWN enumerator (survey.enumeratorId),
   *     not to the admin, so field attribution is preserved.
   *
   * Only a CLOSED (completed) survey is ever exported, so finalizing here is what
   * moves a verified draft into the export set.
   */
  async adminFinalizeSurvey(surveyId: string) {
    const survey = await prisma.survey.findUnique({
      where: { id: surveyId },
      include: { stakeholder: true },
    });
    if (!survey) throw new NotFoundError('Survey');

    const hasIdentityNumber = Boolean(
      (survey.aadharNumber && survey.aadharNumber.trim() !== '') ||
      (survey.udyamAadharRegNo && survey.udyamAadharRegNo.trim() !== '')
    );

    if (!hasIdentityNumber) {
      throw new Error('Cannot finalize survey: Aadhar Number or Udyam Reg. No. is required.');
    }

    if (survey.isCompleted) {
      // Idempotent: already finalized. Return the current state rather than
      // double-locking or writing a second audit row.
      return { status: 'CLOSED', message: 'Survey is already completed.' };
    }

    await prisma.$transaction([
      prisma.survey.update({
        where: { id: surveyId },
        data: { isDraft: false, isCompleted: true, completedAt: new Date() },
      }),
      prisma.stakeholder.update({
        where: { id: survey.stakeholderId },
        data: {
          status: 'CLOSED',
          // Attribute the lock to the field enumerator who did the survey, not
          // the admin performing verification.
          lockedById: survey.enumeratorId,
          lockedAt: new Date(),
        },
      }),
      prisma.auditLog.create({
        data: {
          action: 'survey_admin_finalized',
          entityType: 'survey',
          entityId: surveyId,
          enumeratorId: survey.enumeratorId,
          details: { stakeholderId: survey.stakeholderId },
        },
      }),
    ]);

    logger.info(`Survey admin-finalized: ${surveyId}, stakeholder ${survey.stakeholderId} closed`);

    // Same fan-out as a mobile completion so every open admin view + the field
    // device that owns it converge on CLOSED.
    if (survey.stakeholder.district) {
      emitToDistrictAndAdmins(survey.stakeholder.district, 'stakeholder:locked', {
        stakeholderId: survey.stakeholderId,
        lockedById: survey.enumeratorId,
        lockedAt: new Date().toISOString(),
        district: survey.stakeholder.district,
      });
    }
    broadcastChange(
      ['surveys', 'stakeholders', 'analytics', 'exports', 'auditLogs'],
      { action: 'update', entityId: surveyId, district: survey.stakeholder.district }
    );

    return {
      status: 'CLOSED',
      message: 'Survey finalized. Stakeholder has been closed and is now available for export.',
    };
  }
}