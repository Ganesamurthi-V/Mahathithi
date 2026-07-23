-- MahaAtithi Survey Extension: 3 steps → 8 steps
-- Safe to run on existing data (all new columns are nullable or have defaults)

-- Extend PhotoCategory enum with new document/image types
ALTER TYPE "PhotoCategory" ADD VALUE IF NOT EXISTS 'DISPLAY_IMAGE';
ALTER TYPE "PhotoCategory" ADD VALUE IF NOT EXISTS 'HEADER_SLIDER';
ALTER TYPE "PhotoCategory" ADD VALUE IF NOT EXISTS 'UDYOG_AADHAR_DOC';
ALTER TYPE "PhotoCategory" ADD VALUE IF NOT EXISTS 'AADHAR_CARD_DOC';
ALTER TYPE "PhotoCategory" ADD VALUE IF NOT EXISTS 'PAN_CARD_DOC';
ALTER TYPE "PhotoCategory" ADD VALUE IF NOT EXISTS 'CANCELLED_CHEQUE_DOC';
ALTER TYPE "PhotoCategory" ADD VALUE IF NOT EXISTS 'CUSTOM_DOC';

-- Step 1: Category & Type
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "sub_categories" TEXT[] DEFAULT '{}';

-- Step 2: Basic Information
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "business_name" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "owner_name" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "district" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "taluka" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "village" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "pin_code" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "business_address" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "working_address" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "male_employees" INTEGER;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "female_employees" INTEGER;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "landline" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "alternate_mobile" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "alternate_email" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "aadhar_number" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "udyam_aadhar_reg_no" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "fssai_number" TEXT;

-- Step 4: Details
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "accommodation_facilities" JSONB;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "accommodation_policies" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "working_hours" JSONB;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "faq" JSONB;

-- Step 5: Rooms & Pricing (Accommodations only)
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "rooms" JSONB;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "coupon_codes" JSONB;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "sale_off" DOUBLE PRECISION;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "additional_service_fees" JSONB;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "booking_note" TEXT;

-- Step 6: Your Socials
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "social_links" JSONB;

-- Step 7: Business Documents
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "about_business" TEXT;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "registered_travel_for_life" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "registered_green_leaf" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "received_tourism_award" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "custom_documents" JSONB;

-- Step 8: Terms & Conditions
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "agreed_to_terms" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "declared_info_correct" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "acknowledged_dot_liability" BOOLEAN NOT NULL DEFAULT false;
