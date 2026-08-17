-- Drop unused columns from surveys table
-- These are either old form fields replaced by new ones, or optional fields
-- that were removed from the form and never populated with real data.

-- Old form fields (replaced)
ALTER TABLE surveys DROP COLUMN IF EXISTS contact_person;
ALTER TABLE surveys DROP COLUMN IF EXISTS contact_person_2;
ALTER TABLE surveys DROP COLUMN IF EXISTS designation;
ALTER TABLE surveys DROP COLUMN IF EXISTS mobile_number_2;
ALTER TABLE surveys DROP COLUMN IF EXISTS email_2;
ALTER TABLE surveys DROP COLUMN IF EXISTS website;
ALTER TABLE surveys DROP COLUMN IF EXISTS notes;
ALTER TABLE surveys DROP COLUMN IF EXISTS organization_type;
ALTER TABLE surveys DROP COLUMN IF EXISTS remarks;

-- Optional fields removed from form (Required: No, never populated)
ALTER TABLE surveys DROP COLUMN IF EXISTS taluka;
ALTER TABLE surveys DROP COLUMN IF EXISTS village;
ALTER TABLE surveys DROP COLUMN IF EXISTS working_address;
ALTER TABLE surveys DROP COLUMN IF EXISTS male_employees;
ALTER TABLE surveys DROP COLUMN IF EXISTS female_employees;
ALTER TABLE surveys DROP COLUMN IF EXISTS landline;
ALTER TABLE surveys DROP COLUMN IF EXISTS alternate_mobile;
ALTER TABLE surveys DROP COLUMN IF EXISTS alternate_email;
ALTER TABLE surveys DROP COLUMN IF EXISTS fssai_number;
ALTER TABLE surveys DROP COLUMN IF EXISTS gst_number;
ALTER TABLE surveys DROP COLUMN IF EXISTS faq;
ALTER TABLE surveys DROP COLUMN IF EXISTS coupon_codes;
ALTER TABLE surveys DROP COLUMN IF EXISTS sale_off;
ALTER TABLE surveys DROP COLUMN IF EXISTS additional_service_fees;
ALTER TABLE surveys DROP COLUMN IF EXISTS booking_note;
ALTER TABLE surveys DROP COLUMN IF EXISTS social_links;
ALTER TABLE surveys DROP COLUMN IF EXISTS registered_travel_for_life;
ALTER TABLE surveys DROP COLUMN IF EXISTS registered_green_leaf;
ALTER TABLE surveys DROP COLUMN IF EXISTS received_tourism_award;
ALTER TABLE surveys DROP COLUMN IF EXISTS custom_documents;

-- External columns not in Prisma schema
ALTER TABLE surveys DROP COLUMN IF EXISTS pan_number;
ALTER TABLE surveys DROP COLUMN IF EXISTS establishment_cert_no;
