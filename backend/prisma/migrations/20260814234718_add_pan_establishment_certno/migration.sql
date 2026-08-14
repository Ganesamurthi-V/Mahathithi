-- Add pan_number, establishment_cert_no columns and ESTABLISHMENT_CERT_DOC enum value
-- Safe to run on existing data (all new columns are nullable)

-- Add new PhotoCategory enum values (IF NOT EXISTS is not supported for enum values in PG,
-- but these values do not exist yet so this is safe)
ALTER TYPE "PhotoCategory" ADD VALUE IF NOT EXISTS 'ESTABLISHMENT_CERT_DOC';

-- Add new survey columns
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "pan_number" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "establishment_cert_no" TEXT;
