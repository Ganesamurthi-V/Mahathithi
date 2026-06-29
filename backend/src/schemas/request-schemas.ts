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

const optText = (max: number) => text(max).optional().or(z.literal(''));

/** UUID string (stakeholder IDs, survey IDs, etc.) */
const uuid = z.string().uuid();

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

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
  latitude: latitude.optional(),
  longitude: longitude.optional(),
  gpsAccuracy: z.number().min(0).max(10000).optional(),
  localId: optText(100),
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
  latitude: latitude.optional(),
  longitude: longitude.optional(),
  gpsAccuracy: z.number().min(0).max(10000).optional(),
  localId: optText(100),
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
  type: z.enum(['PHOTO', 'VIDEO']),
  photoCategory: optText(100),
  latitude: z.string().max(30).optional(),
  longitude: z.string().max(30).optional(),
  gpsAccuracy: z.string().max(20).optional(),
  duration: z.string().max(20).optional(),
  localId: optText(100),
});
