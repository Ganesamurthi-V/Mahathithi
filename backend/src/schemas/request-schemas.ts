/**
 * M5 FIX: Centralized Zod request validation schemas.
 *
 * Every free-text field now has a max-length constraint so a single field
 * can never receive ~900KB of text (the old situation with a 1MB body limit
 * and no per-field caps). Numeric fields have range limits. Enum fields are
 * validated against their legal values.
 *
 * Usage in controllers:
 *   import { createSurveySchema } from '../../schemas/request-schemas';
 *   const parsed = createSurveySchema.parse(req.body);
 *
 * ZodErrors are caught by error-handler.ts and returned as clean 400s with
 * field-level detail.
 */

import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ────────────────────────────────────────────────────────────────────────────

/** Trimmed, max-length capped string — the building block for every text field */
const text = (max: number) => z.string().trim().max(max);

// SYNC FIX: accepts '', undefined, AND null on INPUT, but normalizes null
// -> undefined so the inferred TypeScript output type stays
// `string | undefined` (not `string | null | undefined`). The mobile app
// reads these fields straight out of SQLite TEXT columns (business_category,
// notes, etc.); an unset SQLite TEXT column comes back as `null`, not `''`
// or `undefined` — so the mobile sync payload legitimately sends
// `"businessCategory": null`. The original `text(max).optional().or(z.literal(''))`
// rejected `null` outright, causing every offline-queued survey with an
// empty optional field to fail sync with a 400.
//
// IMPORTANT: don't just add `.nullable()` without the transform — that
// widens the parsed output type to `string | null | undefined` everywhere
// this schema is used, which breaks every downstream consumer typed as
// `string | undefined` (CreateSurveyData, media controller fields, etc.)
// with TS2322 errors at build time.
const optText = (max: number) =>
  text(max)
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === null ? undefined : v));

/** UUID string (stakeholder IDs, survey IDs, etc.) */
const uuid = z.string().uuid();

/**
 * Optional finite number, tolerating the shapes a form and SQLite actually send.
 *
 * Mirrors optText's null -> undefined normalisation so the inferred output type
 * stays `number | undefined`. Also accepts '' because an untouched numeric input
 * in both clients submits an empty string, and rejecting that would make every
 * blank optional number a 400.
 *
 * `.finite()` matters: z.number() alone accepts NaN and Infinity, and either would
 * be written straight into a double precision column.
 */
const optNumber = () =>
  z
    .union([z.number().finite(), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v === null ? undefined : v));

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

/**
 * Aadhaar number — 12 digits, optional.
 *
 * Mirrors the rule SurveyFormScreen already enforces on the client
 * (`pattern: /^\d{12}$/`). Validated server-side too because a client-side rule
 * is advice, not a constraint: the endpoint is reachable directly.
 *
 * Accepts '', null and undefined the same way optText does, so an unset SQLite
 * TEXT column arriving as null does not fail a sync.
 *
 * NOTE: the value is currently persisted as plaintext. If the AES-256-GCM
 * encryption described in the plan is added, ciphertext will not be 12 digits and
 * this rule must move to the pre-encryption boundary rather than the wire schema.
 */
const optAadhaar = z
  .string()
  .trim()
  .regex(/^\d{12}$/, 'Aadhar Number must be exactly 12 digits')
  .nullable()
  .optional()
  .or(z.literal(''))
  .transform((v) => (v === null ? undefined : v));

// ────────────────────────────────────────────────────────────────────────────
// Survey
// ────────────────────────────────────────────────────────────────────────────

export const createSurveySchema = z.object({
  stakeholderId: uuid,
  contactPerson: optText(200),
  designation: optText(200),
  mobileNumber: optText(20),
  email: optText(200),
  contactPerson2: optText(200),
  mobileNumber2: optText(20),
  email2: optText(200),
  website: optText(500),
  businessCategory: optText(200),
  notes: optText(2000),
  gstNumber: optText(15),
  organizationType: optText(200),
  remarks: optText(2000),
  // SYNC FIX: these two fields are real Survey columns (nearest_police_station,
  // nearest_healthcare_center) and were already covered by syncSurveyItemSchema
  // (which uses .passthrough() so they slipped through unvalidated), but were
  // never added here. createSurveySchema is .strict(), so the mobile app's
  // *online* save path (SurveyFormScreen.tsx, distinct from the offline sync
  // queue) sent these fields and got an unconditional 400 on every submit —
  // even with a perfect network connection — since .strict() rejects any key
  // the schema doesn't know about.
  nearestPoliceStation: optText(300),
  nearestHealthcareCenter: optText(300),
  latitude: latitude.optional(),
  longitude: longitude.optional(),
  gpsAccuracy: z.number().min(0).max(10000).optional(),
  localId: optText(100),

  // ─── Step 1: Category & Type ─────────────────────────────────────────────
  subCategories: z.array(z.string().max(100)).max(3).optional(),

  // ─── Step 2: Basic Information ───────────────────────────────────────────
  businessName: optText(500),
  ownerName: optText(200),
  district: optText(200),
  city: optText(200),
  taluka: optText(200),
  village: optText(200),
  pinCode: optText(10),
  businessAddress: optText(1000),
  workingAddress: optText(1000),
  maleEmployees: z.number().int().min(0).optional().nullable().transform((v) => (v === null ? undefined : v)),
  femaleEmployees: z.number().int().min(0).optional().nullable().transform((v) => (v === null ? undefined : v)),
  landline: optText(20),
  alternateMobile: optText(20),
  alternateEmail: optText(200),
  // SYNC FIX: aadharNumber and udyamAadharRegNo are real Survey columns
  // (aadhar_number, udyam_aadhar_reg_no) and survey.service.ts already maps both
  // into the Prisma write — but neither was declared here. Because this schema is
  // .strict(), every ONLINE submit from SurveyFormScreen was rejected with a 400
  // before reaching the service, on an unknown-key error. aadharNumber is a
  // required field on that form, so the online save path could never succeed at
  // all; only the offline queue worked, and only because syncSurveyItemSchema uses
  // .passthrough() and let them through unvalidated.
  aadharNumber: optAadhaar,
  udyamAadharRegNo: optText(50),
  panNumber: optText(20),
  establishmentCertNo: optText(100),
  fssaiNumber: optText(50),

  // ─── Step 4: Details ─────────────────────────────────────────────────────
  description: optText(5000),
  accommodationFacilities: z.array(z.string().max(100)).optional().nullable().transform((v) => (v === null ? undefined : v)),
  accommodationPolicies: optText(5000),
  workingHours: z.array(z.object({
    day: z.string().max(20),
    type: z.enum(['open_all_day', 'closed', 'hours']),
    from: z.string().max(10).optional(),
    to: z.string().max(10).optional(),
  })).optional().nullable().transform((v) => (v === null ? undefined : v)),
  faq: z.array(z.object({
    question: z.string().max(500),
    answer: z.string().max(2000),
  })).optional().nullable().transform((v) => (v === null ? undefined : v)),

  // ─── Step 5: Rooms & Pricing (Accommodations only) ───────────────────────
  rooms: z.array(z.any()).optional().nullable().transform((v) => (v === null ? undefined : v)),
  couponCodes: z.array(z.any()).optional().nullable().transform((v) => (v === null ? undefined : v)),
  saleOff: z.number().min(0).max(100).optional().nullable().transform((v) => (v === null ? undefined : v)),
  additionalServiceFees: z.array(z.any()).optional().nullable().transform((v) => (v === null ? undefined : v)),
  bookingNote: optText(2000),

  // ─── Step 6: Your Socials ────────────────────────────────────────────────
  socialLinks: z.array(z.object({
    platform: z.string().max(50),
    url: z.string().max(500),
  })).optional().nullable().transform((v) => (v === null ? undefined : v)),

  // ─── Step 7: Business Documents ──────────────────────────────────────────
  aboutBusiness: optText(5000),
  registeredTravelForLife: z.boolean().optional().nullable().transform((v) => (v === null ? undefined : v)),
  registeredGreenLeaf: z.boolean().optional().nullable().transform((v) => (v === null ? undefined : v)),
  receivedTourismAward: z.boolean().optional().nullable().transform((v) => (v === null ? undefined : v)),
  customDocuments: z.array(z.any()).optional().nullable().transform((v) => (v === null ? undefined : v)),

  // ─── Step 8: Terms & Conditions ──────────────────────────────────────────
  agreedToTerms: z.boolean().optional().nullable().transform((v) => (v === null ? undefined : v)),
  declaredInfoCorrect: z.boolean().optional().nullable().transform((v) => (v === null ? undefined : v)),
  acknowledgedDotLiability: z.boolean().optional().nullable().transform((v) => (v === null ? undefined : v)),
}).strict();

// ────────────────────────────────────────────────────────────────────────────
// Phone validation
// ────────────────────────────────────────────────────────────────────────────

const phoneValidationStatus = z.enum(['PENDING_VERIFICATION', 'VERIFIED', 'FAILED']);

export const createPhoneValidationSchema = z.object({
  stakeholderId: uuid,
  phoneNumber: text(20),
  status: phoneValidationStatus,
  method: z.enum(['phone_call', 'sms', 'whatsapp']).optional(),
  remarks: optText(2000),
}).strict();

export const updatePhoneValidationSchema = z.object({
  status: phoneValidationStatus.optional(),
  remarks: optText(2000),
}).strict();

// ────────────────────────────────────────────────────────────────────────────
// Stakeholder PATCH (enumerator-editable fields only)
// ────────────────────────────────────────────────────────────────────────────

export const updateStakeholderSchema = z.object({
  companyNameStandardized: optText(500),
  addressLine1: optText(500),
  addressLine2: optText(500),
  city: optText(200),
  taluka: optText(200),
  village: optText(200),
  pinCode: optText(10),
  category: optText(200),
  latitude: latitude.optional(),
  longitude: longitude.optional(),
  digipin: optText(10),
}).strict();

/**
 * Create a stakeholder by hand, rather than via the Excel bulk import.
 *
 * Only the business name is mandatory. Everything the registry import supplies
 * (CIN, TIN, NIC codes, capital figures, dedup/lineage columns) is deliberately
 * NOT accepted here: those are provenance fields owned by the import pipeline, and
 * letting an operator type them in would produce records that look sourced from
 * MCA/Udyam when they are not.
 *
 * `district` is accepted but authorisation over it is enforced in the service, not
 * here — a non-admin may only create inside their assigned districts. `status` is
 * not accepted; new records always start OPEN.
 *
 * primaryKeyId is assigned server-side. It is a unique Int the import populates
 * from the spreadsheet's Primary_Key_ID, so a client-supplied value would risk
 * colliding with a future import row.
 */
export const createStakeholderSchema = z.object({
  // ── Identity ──
  // NOT text(500): that is z.string().trim().max(n), which accepts ''. A nameless
  // stakeholder renders as '—' in every list in both clients and is effectively
  // unfindable afterwards, so the one mandatory field is required for real.
  companyNameStandardized: z.string().trim().min(1, 'Organization name is required').max(500),
  companyNameOriginal: optText(500),
  uin: optText(100),

  // ── Registration numbers ──
  cinNumber: optText(50),
  gstNumber: optText(20),
  tinNumber: optText(50),

  // ── Address ──
  fullAddressRaw: optText(1000),
  addressLine1: optText(500),
  addressLine2: optText(500),
  city: optText(200),
  taluka: optText(200),
  village: optText(200),
  district: optText(200),
  state: optText(200),
  pinCode: optText(10),

  // ── Classification ──
  nicCode: optText(20),
  nicDescription: optText(500),
  category: optText(200),
  companyClass: optText(100),
  companyStatus: optText(100),
  companyCategory: optText(100),
  listingStatus: optText(100),

  // ── Financials ──
  // Plain numbers, not currency-parsed: the import writes raw doubles and this
  // must round-trip identically or a manual row would sort differently.
  authorizedCapital: optNumber(),
  paidupCapital: optNumber(),

  // registration_date is TEXT in the database, not a date column — the import
  // stores whatever format the source sheet used. Kept as text so a manual entry
  // matches imported rows rather than silently normalising to ISO.
  registrationDate: optText(50),

  // ── Ranking ──
  priorityWeight: optNumber(),

  // ── Dedup / lineage ──
  // These are outputs of the import's matching pipeline rather than facts about
  // the business. Exposed because every column was asked for, but they are grouped
  // separately in both clients so it is clear they are not ordinary inputs.
  fuzzySimilarityScore: optNumber(),
  crossSourceMatch: optText(200),
  humanReviewRequired: optText(50),
  dedupMatchStatus: optText(100),
  sourceLineageNotes: optText(1000),

  // ── Location ──
  latitude: latitude.optional(),
  longitude: longitude.optional(),
  digipin: optText(10),

  // DELIBERATELY ABSENT, and why — these 8 stay server-owned:
  //   id, primaryKeyId  assigned server-side; primaryKeyId is a unique Int taken
  //                     from MAX+1 and a client value could collide with a future
  //                     import row
  //   createdAt/updatedAt  timestamps
  //   status            new records always start OPEN; changing it is the existing
  //                     admin-only PATCH /:id/status
  //   lockedById/lockedAt  owned by the lock/unlock workflow
  //   dataSource        forced to 'MANUAL'. This is the provenance marker that
  //                     separates hand-entered rows from MCA/Udyam-imported ones;
  //                     if it were settable, a manual record could claim to be
  //                     registry-sourced and there would be no way to tell.
}).strict();

// ────────────────────────────────────────────────────────────────────────────
// Sync upload — per-item sub-schemas
// ────────────────────────────────────────────────────────────────────────────

/** Single survey item inside a sync batch — same fields as createSurveySchema
 *  but stakeholderId is embedded per-item rather than at the top level */
export const syncSurveyItemSchema = z.object({
  stakeholderId: uuid,
  contactPerson: optText(200),
  designation: optText(200),
  mobileNumber: optText(20),
  email: optText(200),
  // B4 FIX: validate secondary contact fields explicitly so they carry the
  // same length limits as the online createSurveySchema and are persisted.
  contactPerson2: optText(200),
  mobileNumber2: optText(20),
  email2: optText(200),
  website: optText(500),
  businessCategory: optText(200),
  notes: optText(2000),
  gstNumber: optText(15),
  organizationType: optText(200),
  remarks: optText(2000),
  // Declared explicitly rather than relying on .passthrough(). Passthrough carries
  // a field to the service with NO length cap, which defeats the per-field limits
  // this file exists to enforce — the mobile sync payload is the one path that can
  // send large values. Both are real Survey columns and are mapped by
  // sync.service.ts.
  nearestPoliceStation: optText(300),
  nearestHealthcareCenter: optText(300),
  latitude: latitude.optional(),
  longitude: longitude.optional(),
  gpsAccuracy: z.number().min(0).max(10000).optional(),
  localId: optText(100),

  // ─── Step 1: Category & Type ─────────────────────────────────────────────
  subCategories: z.array(z.string().max(100)).max(3).optional(),

  // ─── Step 2: Basic Information ───────────────────────────────────────────
  businessName: optText(500),
  ownerName: optText(200),
  district: optText(200),
  city: optText(200),
  taluka: optText(200),
  village: optText(200),
  pinCode: optText(10),
  businessAddress: optText(1000),
  workingAddress: optText(1000),
  maleEmployees: z.number().int().min(0).optional().nullable().transform((v) => (v === null ? undefined : v)),
  femaleEmployees: z.number().int().min(0).optional().nullable().transform((v) => (v === null ? undefined : v)),
  landline: optText(20),
  alternateMobile: optText(20),
  alternateEmail: optText(200),
  // Same reasoning as createSurveySchema: real columns, mapped by sync.service.ts,
  // previously only reaching it via .passthrough() with no validation at all.
  aadharNumber: optAadhaar,
  udyamAadharRegNo: optText(50),
  panNumber: optText(20),
  establishmentCertNo: optText(100),
  fssaiNumber: optText(50),

  // ─── Step 4: Details ─────────────────────────────────────────────────────
  description: optText(5000),
  accommodationFacilities: z.array(z.string().max(100)).optional().nullable().transform((v) => (v === null ? undefined : v)),
  accommodationPolicies: optText(5000),
  workingHours: z.array(z.object({
    day: z.string().max(20),
    type: z.enum(['open_all_day', 'closed', 'hours']),
    from: z.string().max(10).optional(),
    to: z.string().max(10).optional(),
  })).optional().nullable().transform((v) => (v === null ? undefined : v)),
  faq: z.array(z.object({
    question: z.string().max(500),
    answer: z.string().max(2000),
  })).optional().nullable().transform((v) => (v === null ? undefined : v)),

  // ─── Step 5: Rooms & Pricing ─────────────────────────────────────────────
  rooms: z.array(z.any()).optional().nullable().transform((v) => (v === null ? undefined : v)),
  couponCodes: z.array(z.any()).optional().nullable().transform((v) => (v === null ? undefined : v)),
  saleOff: z.number().min(0).max(100).optional().nullable().transform((v) => (v === null ? undefined : v)),
  additionalServiceFees: z.array(z.any()).optional().nullable().transform((v) => (v === null ? undefined : v)),
  bookingNote: optText(2000),

  // ─── Step 6: Your Socials ────────────────────────────────────────────────
  socialLinks: z.array(z.object({
    platform: z.string().max(50),
    url: z.string().max(500),
  })).optional().nullable().transform((v) => (v === null ? undefined : v)),

  // ─── Step 7: Business Documents ──────────────────────────────────────────
  aboutBusiness: optText(5000),
  registeredTravelForLife: z.boolean().optional().nullable().transform((v) => (v === null ? undefined : v)),
  registeredGreenLeaf: z.boolean().optional().nullable().transform((v) => (v === null ? undefined : v)),
  receivedTourismAward: z.boolean().optional().nullable().transform((v) => (v === null ? undefined : v)),
  customDocuments: z.array(z.any()).optional().nullable().transform((v) => (v === null ? undefined : v)),

  // ─── Step 8: Terms & Conditions ──────────────────────────────────────────
  agreedToTerms: z.boolean().optional().nullable().transform((v) => (v === null ? undefined : v)),
  declaredInfoCorrect: z.boolean().optional().nullable().transform((v) => (v === null ? undefined : v)),
  acknowledgedDotLiability: z.boolean().optional().nullable().transform((v) => (v === null ? undefined : v)),
}).passthrough(); // allow extra mobile-specific fields to pass through

export const syncPhoneValidationItemSchema = z.object({
  stakeholderId: uuid,
  phoneNumber: text(20),
  status: phoneValidationStatus,
  method: z.enum(['phone_call', 'sms', 'whatsapp']).optional(),
  verifiedAt: z.string().max(50).optional().nullable(),
  remarks: optText(2000),
  localId: optText(100),
}).passthrough();

export const syncUploadSchema = z.object({
  surveys: z.array(syncSurveyItemSchema).max(200).optional().default([]),
  phoneValidations: z.array(syncPhoneValidationItemSchema).max(200).optional().default([]),
  mediaMetadata: z.array(z.any()).max(200).optional().default([]),
}).strict();

// ────────────────────────────────────────────────────────────────────────────
// Auth
// ────────────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  loginId: text(100),
  password: text(200),
}).strict();

// ────────────────────────────────────────────────────────────────────────────
// Admin — enumerator management
// ────────────────────────────────────────────────────────────────────────────

export const createEnumeratorSchema = z.object({
  loginId: text(100),
  password: text(200),
  name: text(200),
  phone: optText(20),
  email: optText(200),
  isAdmin: z.boolean().optional(),
  districtIds: z.array(uuid).max(50).optional(),
}).strict();

export const updateEnumeratorSchema = z.object({
  name: text(200).optional(),
  phone: optText(20),
  email: optText(200),
  isActive: z.boolean().optional(),
  password: text(200).optional(),
}).strict();

// ────────────────────────────────────────────────────────────────────────────
// Media upload (form-data fields — validated after multer parses them)
// ────────────────────────────────────────────────────────────────────────────

export const mediaUploadFieldsSchema = z.object({
  surveyId: text(200),
  type: z.enum(['PHOTO', 'VIDEO', 'DOCUMENT']),
  photoCategory: optText(100),
  latitude: z.string().max(30).optional(),
  longitude: z.string().max(30).optional(),
  gpsAccuracy: z.string().max(20).optional(),
  duration: z.string().max(20).optional(),
  localId: optText(100),
});