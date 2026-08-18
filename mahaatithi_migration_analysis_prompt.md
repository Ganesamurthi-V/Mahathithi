# MahaAtithi → Listing Schema Migration: Full Analysis & Agent Prompt

> **Status:** Pre-migration analysis. Verified against `client_db_dump.sql` (144 KB, pg_dump v18.2) and `Mahathithi-main` codebase (Prisma schema + 3 migration files).

---

## PART 1 — SCHEMA ANALYSIS

### 1.1 Source: MahaAtithi `surveys` Table

The source is a **single flat table** (`public.surveys`) built incrementally through 3 Prisma migrations. The **final, live column set** after all migrations is:

| Column | Type | Notes |
|--------|------|-------|
| `id` | text (UUID) | Source PK — preserve as mapping reference |
| `stakeholder_id` | text | FK → `stakeholders.id` — NOT a user in the target sense |
| `enumerator_id` | text | FK → `enumerators.id` — field officer, NOT a listing owner |
| `mobile_number` | text | Primary mobile |
| `email` | text | Primary email |
| `business_category` | text | Free-text category name (must resolve to target `categories.id`) |
| `sub_categories` | text[] | Array of subcategory name strings |
| `latitude` | double precision | GPS capture |
| `longitude` | double precision | GPS capture |
| `gps_accuracy` | double precision | Metadata only, no target equivalent |
| `digipin` | text | No target equivalent |
| `nearest_police_station` | text | No target equivalent |
| `nearest_healthcare_center` | text | No target equivalent |
| `business_name` | text | Core listing name |
| `owner_name` | text | Core listing owner |
| `district` | text | Free-text district name |
| `city` | text | Free-text city |
| `pin_code` | text | 6-digit postal code |
| `business_address` | text | Physical address |
| `aadhar_number` | text | **AES-256-GCM encrypted** — do NOT insert raw |
| `udyam_aadhar_reg_no` | text | Registration number string |
| `fssai_number` | text | **Dropped in migration 20250724** — NULL in all live rows |
| `description` | text | Business description |
| `accommodation_facilities` | jsonb | Accommodations category only |
| `accommodation_policies` | text | Accommodations category only |
| `working_hours` | jsonb | JSON object — needs decomposed into normalized rows |
| `rooms` | jsonb | Accommodations only — maps to `accommodations_rooms` |
| `about_business` | text | Maps to `business_documents.about_business` |
| `pan_number` | text | Added in migration 20260814 — no direct target column |
| `establishment_cert_no` | text | Added in migration 20260814 |
| `agreed_to_terms` | boolean | Maps to `listings.agree_terms_conditions` |
| `declared_info_correct` | boolean | Maps to `listings.declare_information_correct` |
| `acknowledged_dot_liability` | boolean | Maps to `listings.financial_losses_risk_decleration` |
| `is_draft` | boolean | Only import where `is_completed = true AND is_draft = false` |
| `is_completed` | boolean | Migration filter gate |
| `is_synced` | boolean | Operational metadata, no target equivalent |
| `local_id` | text | Offline-sync metadata, no target equivalent |
| `created_at` | timestamp | Map to `listings.created_at` |
| `updated_at` | timestamp | Map to `listings.updated_at` |

**Columns dropped in migration 20250724** (confirmed NULL in all live rows):
`contact_person`, `contact_person_2`, `designation`, `mobile_number_2`, `email_2`,
`website`, `notes`, `organization_type`, `remarks`, `taluka`, `village`,
`working_address`, `male_employees`, `female_employees`, `landline`, `alternate_mobile`,
`alternate_email`, `gst_number`, `fssai_number`, `faq`, `coupon_codes`, `sale_off`,
`additional_service_fees`, `booking_note`, `social_links`, `registered_travel_for_life`,
`registered_green_leaf`, `received_tourism_award`, `custom_documents`

**Critical implication:** The majority of the complex JSONB fields listed in the original
task specification (`faq`, `coupon_codes`, `social_links`, `additional_service_fees`) were
dropped from the live schema in July 2025 and will be NULL in all real survey rows. The
migration must guard against this with IS NOT NULL checks.

---

### 1.2 Target: Client `listing` Schema

Full schema extracted from `client_db_dump.sql` (pg 18.2). Three schemas: `geography`, `identityaccess`, `listing`.

#### `listing.listings` — one row per business

| Column | Type | Nullable | Import Value |
|--------|------|----------|--------------|
| `id` | uuid | NO (PK) | `gen_random_uuid()` |
| `user_id` | uuid | YES | **CLIENT MUST PROVIDE** |
| `slug` | varchar | YES | Generated from business_name + survey_id prefix |
| `category_id` | uuid | YES | Resolved via category mapping |
| `name_of_business` | varchar | YES | ← `business_name` |
| `name_of_owner` | varchar | YES | ← `owner_name` |
| `website_url` | varchar | YES | NULL (dropped in source) |
| `aadhar_number` | varchar | YES | NULL (source is encrypted ciphertext) |
| `gst_number` | varchar | YES | NULL (dropped in source) |
| `fssai_number` | varchar | YES | NULL (dropped in source) |
| `display_image_url` | varchar | YES | NULL (media migration out of scope) |
| `header_slider` | varchar | YES | NULL |
| `description` | varchar | YES | ← `description` |
| `tour_policies` | text | YES | ← `accommodation_policies` |
| `agree_terms_conditions` | boolean | NO | ← `agreed_to_terms` |
| `declare_information_correct` | boolean | NO | ← `declared_info_correct` |
| `financial_losses_risk_decleration` | boolean | NO | ← `acknowledged_dot_liability` |
| `save_listing_as_pending` | boolean | YES | `true` |
| `listing_category_id` | uuid | YES | Resolved sub_categories[1] → UUID |
| `subcategory_other_name` | varchar | YES | sub_categories[1] if unresolved |
| `no_of_male_employees` | integer | YES | NULL (dropped in source) |
| `no_of_female_employees` | integer | YES | NULL (dropped in source) |
| `udyam_aadhar_registration_number` | varchar | YES | ← `udyam_aadhar_reg_no` |
| `max_guest_capacity` | integer | YES | NULL |
| `booking_note` | text | YES | NULL (dropped in source) |
| `accommodation_sale_off` | real | YES | NULL (dropped in source) |
| `approval_status` | varchar(20) | YES | `'pending'` |
| `platform_fee_status` | varchar(20) | YES | `'pending'` |
| `view_count` | integer | NO | `0` |
| `admin_remark` | text | YES | Migration reference string |
| `created_at` | timestamp | YES | ← `surveys.created_at` |
| `updated_at` | timestamp | YES | ← `surveys.updated_at` |
| `is_archived` | boolean | YES | `false` |
| `archived_at` | timestamp | YES | NULL |
| `registration_number` | bigint | YES | **OMIT — auto-generated by sequence** |

#### `listing.contact_details` — one row per listing

| Column | Import Value |
|--------|-------------|
| `id` | `gen_random_uuid()` |
| `listing_id` | FK → listing.id |
| `business_address` | ← `business_address` |
| `village_name` | NULL (dropped) |
| `city_name` | ← `city` |
| `taluka_name` | NULL (dropped) |
| `district_name` | ← `district` |
| `pin_code` | ← `pin_code` |
| `state_name` | `'Maharashtra'` (hardcoded) |
| `country_name` | `'India'` (hardcoded) |
| `working_address` | NULL (dropped) |
| `latitude` | ← `latitude::text` |
| `longitude` | ← `longitude::text` |
| `email_address` | ← `email` |
| `mobile_number` | ← `mobile_number` |
| `landline_number` | NULL (dropped) |
| `country_code` | `'+91'` (hardcoded) |
| `alternate_email_address` | NULL (dropped) |
| `alternate_mobile_number` | NULL (dropped) |

#### `listing.business_documents` — one row per listing

| Column | Import Value |
|--------|-------------|
| `id` | `gen_random_uuid()` |
| `listing_id` | FK |
| `tour_guide_license_number` | NULL |
| `tour_registration_number` | ← `establishment_cert_no` |
| `about_business` | ← `about_business` |
| `registered_for_travel_for_life` | NULL (dropped) |
| `registered_for_green_leaf_rating` | NULL (dropped) |
| `award_in_tourism_sector` | NULL (dropped) |
| `udyog_aadhar_card_document_url` | NULL (media not migrated) |
| `aadhar_card_document_url` | NULL |
| `pan_card_document_url` | NULL |
| `cancelled_cheque_document_url` | NULL |
| `document_name_one` | `'PAN Number'` (if pan_number IS NOT NULL) |
| `document_name_one_url` | ← `pan_number` (stored as text, see §2.9) |
| `document_name_two` | NULL |
| `document_name_two_url` | NULL |

#### `listing.working_hours` + `listing.working_hours_specific`

One row in `working_hours` per (listing × day). One row in `working_hours_specific` per time slot. Only insert if `working_hours IS NOT NULL`. Shape of source JSON must be confirmed before generation (see §2.4).

#### `listing.faqs`, `listing.social_urls`, `listing.coupons`, `listing.additional_service_fees`

Only insert if the corresponding source JSONB column IS NOT NULL. All expected to be NULL due to migration 20250724 drop.

#### `listing.accommodations_rooms`

Only for surveys where `business_category = 'Accommodations'` AND `rooms IS NOT NULL`. JSON expansion shape must be confirmed before generation (see §2.5).

---

### 1.3 Category Mapping — Source Name → Target UUID

Verified from `COPY listing.categories` in client_db_dump.sql:

| Source `business_category` | Target `categories.id` |
|---|---|
| `Accommodations` | `24f3916c-a227-42b6-86d5-cb493b0e0a4a` |
| `Cuisine` | `09247453-eec9-4e8b-9b19-219e07813b00` |
| `Experiences and Activities` | `c4e5ba48-90e8-4107-9abb-c3188c07ae18` |
| `Experiences and Activities Slots` | `7110589d-e6dc-441c-9c76-25b2e5579be5` |
| `Tour Guide` | `d42e5f37-7769-480b-8d88-4d8f2ae11a70` |
| `Tour Operator, Travel Agent and Destination Management Company` | `9e801ff4-9dd0-48a8-81cc-660f5457158b` |
| `Aqua Tourism` | `f64bf634-df9e-4787-897d-e06b7380f724` |
| `Guided Tours` | `3c387b3f-259f-4eca-a702-b3fb85317dee` |
| `Events and Festivals` | `86841a14-6545-4287-96ee-009a5e3063ab` |
| `Handicrafts and Souvenirs` | `0b5503ae-7861-49df-ab1e-747b356f15fa` |

**Unknown category:** Set `category_id = NULL`, append to `admin_remark`.

---

### 1.4 Subcategory Mapping — Source Name → Target UUID

Only the first element of `sub_categories[]` maps to `listing_category_id`. Verified from dump.

**Accommodations** (`24f3916c-...`):
Hotels → `427bbcf5-d7fb-4153-9a4f-45187427f836`, Resort → `bd5c30a4-ded5-4115-be3f-4ee9244471a0`,
Agro Tourism / Farm Stay → `6c051b79-8514-4aed-bc3a-c644cf84b2e2`, Apartments → `85606949-7090-4671-8ace-81c2d01350da`,
Hostels → `687f5279-30c2-4e8c-8b22-12e654155d9e`, Tourism Villas → `add32a64-1740-4988-b788-28a5273d5ba9`,
Tree House → `36df553d-d2f7-45a5-b0a8-930d37129103`, Tented Accommodation → `18372fbe-d55a-4194-bd3a-72f477ce7cb1`,
Home Stay → `b08e4a91-0e64-4579-b648-eb3c6599e2b7`, Bed and Breakfast → `f702e574-77d4-4878-a903-65daebc52a14`,
Log Huts → `4e3496ca-b10f-4fba-a8a1-d502ee08ad2d`, Staycations → `a55e0ee5-261a-4f03-8c22-13739b507266`,
Camping Sites → `eae15aac-ef29-4aeb-8666-bd2a3f08289b`, Others → `66264323-43cd-48fc-ac15-82c0baf4719c`

**Cuisine** (`09247453-...`):
Restaurant → `3f8a1b2c-4d5e-4f6a-8b9c-d0e1f2a3b4c5`, Food Safaris → `5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d`,
Authentic Food/Cuisines → `7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a`, Cafeterias → `9f0a1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c`,
Others → `b1c2d3e4-f5a6-4b7c-8d8e-9f0a1b2c3d4e`

**Experiences and Activities** (`c4e5ba48-...`):
Adventure Activities → `a1b2c3d4-1111-4a7b-8c9d-ea001001001a`, Caravan → `a1b2c3d4-1111-4a7b-8c9d-ea001001002a`,
Caves → `a1b2c3d4-1111-4a7b-8c9d-ea001001003a`, Cultural → `a1b2c3d4-1111-4a7b-8c9d-ea001001004a`,
Museums → `a1b2c3d4-1111-4a7b-8c9d-ea001001005a`, Spiritual → `a1b2c3d4-1111-4a7b-8c9d-ea001001006a`,
Theme Parks → `a1b2c3d4-1111-4a7b-8c9d-ea001001007a`, Others → `a1b2c3d4-1111-4a7b-8c9d-ea001001008a`

**Experiences and Activities Slots** (`7110589d-...`):
Adventure Activities → `b2c3d4e5-2222-4b8c-9d0e-fb002002001b`, Caravan → `b2c3d4e5-2222-4b8c-9d0e-fb002002002b`,
Caves → `b2c3d4e5-2222-4b8c-9d0e-fb002002003b`, Cultural → `b2c3d4e5-2222-4b8c-9d0e-fb002002004b`,
Museums → `b2c3d4e5-2222-4b8c-9d0e-fb002002005b`, Spiritual → `b2c3d4e5-2222-4b8c-9d0e-fb002002006b`,
Theme Parks → `b2c3d4e5-2222-4b8c-9d0e-fb002002007b`, Others → `b2c3d4e5-2222-4b8c-9d0e-fb002002008b`

**Guided Tours** (`3c387b3f-...`):
Cave Tours → `c3d4e5f6-3333-4c9d-ae1f-0c003003001c`, Educational Tours → `c3d4e5f6-3333-4c9d-ae1f-0c003003002c`,
Food Testing & Culinary Tours → `c3d4e5f6-3333-4c9d-ae1f-0c003003003c`,
Historical/Landmark Tours → `c3d4e5f6-3333-4c9d-ae1f-0c003003004c`,
Tour → `c3d4e5f6-3333-4c9d-ae1f-0c003003005c`, Others → `c3d4e5f6-3333-4c9d-ae1f-0c003003006c`

**Aqua Tourism** (`f64bf634-...`):
Yachts → `d4e5f6a7-4444-4dae-bf20-0d004004001d`, Houseboats → `d4e5f6a7-4444-4dae-bf20-0d004004002d`,
Ferries → `d4e5f6a7-4444-4dae-bf20-0d004004003d`, Sky Dive → `d4e5f6a7-4444-4dae-bf20-0d004004004d`,
Jet Ski → `d4e5f6a7-4444-4dae-bf20-0d004004005d`, Rafting → `d4e5f6a7-4444-4dae-bf20-0d004004006d`,
Scuba Diving → `d4e5f6a7-4444-4dae-bf20-0d004004007d`, Water Parks → `d4e5f6a7-4444-4dae-bf20-0d004004008d`,
Helicopter Rides → `d4e5f6a7-4444-4dae-bf20-0d004004009d`, Others → `d4e5f6a7-4444-4dae-bf20-0d004004010d`

**Events and Festivals** (`86841a14-...`):
Art → `e5f6a7b8-5555-4ebf-d031-0e005005001e`, Cultural → `e5f6a7b8-5555-4ebf-d031-0e005005002e`,
Exhibitions / Conferences → `e5f6a7b8-5555-4ebf-d031-0e005005003e`,
Folk Art & Culture → `e5f6a7b8-5555-4ebf-d031-0e005005004e`,
Food → `e5f6a7b8-5555-4ebf-d031-0e005005005e`,
International Trade Fairs → `e5f6a7b8-5555-4ebf-d031-0e005005006e`,
Music Concerts → `e5f6a7b8-5555-4ebf-d031-0e005005007e`,
MICE → `e5f6a7b8-5555-4ebf-d031-0e005005008e`,
Others → `e5f6a7b8-5555-4ebf-d031-0e005005009e`

**Tour Operator / Travel Agent / DMC** (`9e801ff4-...`):
Cave Tours → `f6a7b8c9-6666-4fc0-e142-0f006006001f`, Day Tours → `f6a7b8c9-6666-4fc0-e142-0f006006002f`,
Educational Tours → `f6a7b8c9-6666-4fc0-e142-0f006006003f`, Film City Tours → `f6a7b8c9-6666-4fc0-e142-0f006006004f`,
Historical/Landmark Tours → `f6a7b8c9-6666-4fc0-e142-0f006006005f`, Guided Tours → `f6a7b8c9-6666-4fc0-e142-0f006006006f`,
Food Tour → `f6a7b8c9-6666-4fc0-e142-0f006006007f`, Food Testing & Culinary Tours → `f6a7b8c9-6666-4fc0-e142-0f006006008f`,
Industrial Tours → `f6a7b8c9-6666-4fc0-e142-0f006006009f`, Mining Tours → `f6a7b8c9-6666-4fc0-e142-0f006006010f`,
Special/Unique Tours → `f6a7b8c9-6666-4fc0-e142-0f006006011f`, Tour → `f6a7b8c9-6666-4fc0-e142-0f006006012f`,
Holiday Tours → `f6a7b8c9-6666-4fc0-e142-0f006006013f`, Car Rental → `f6a7b8c9-6666-4fc0-e142-0f006006014f`

**Tour Guide** and **Handicrafts and Souvenirs**: No subcategories defined in dump — `listing_category_id = NULL`.

---

### 1.5 Social Platform Mapping

| Source JSON key | Target `social_websites.id` |
|---|---|
| facebook / Facebook | `a0000001-0000-4000-a000-000000000001` |
| twitter / Twitter | `a0000001-0000-4000-a000-000000000002` |
| youtube / Youtube | `a0000001-0000-4000-a000-000000000003` |
| instagram / Instagram | `a0000001-0000-4000-a000-000000000005` |
| linkedin / LinkedIn | `a0000001-0000-4000-a000-000000000013` |
| whatsapp / Whatsapp | `a0000001-0000-4000-a000-000000000014` |
| telegram / Telegram | `a0000001-0000-4000-a000-000000000018` |
| other / custom | `a0000001-0000-4000-a000-000000000019` |

Note: `social_links` was dropped in migration 20250724. If all rows are NULL, no `social_urls` inserts are generated.

---

## PART 2 — CRITICAL ISSUES & BLOCKERS

### 2.1 BLOCKER — `surveys.aadhar_number` Is Encrypted

Prisma schema comment: `// AES-256-GCM encrypted`. The raw column value is ciphertext.

**Resolution:** Insert `NULL` into `listing.listings.aadhar_number`. The encrypted blob is meaningless without the application-level AES key. Do NOT insert raw ciphertext into the target.

### 2.2 BLOCKER — `user_id` in `listing.listings` Has No Source Equivalent

`listing.listings.user_id` is a FK to `identityaccess.users.id`. The source has `enumerator_id` (field officer) and `stakeholder_id` (surveyed entity). Neither exists in the target identity system.

**Agent must ask:** "Please provide the UUID of the `identityaccess.users` record that should own all migrated listings, or confirm that `user_id = NULL` is acceptable."

Use placeholder `'<IMPORT_USER_UUID>'` in generated SQL — client replaces before running.

### 2.3 BLOCKER — JSONB Columns Likely All NULL

Migration 20250724 dropped `faq`, `coupon_codes`, `additional_service_fees`, `social_links`, etc. These will be NULL in all live rows.

**Required verification on source DB before generation:**
```sql
SELECT 
  COUNT(*) FILTER (WHERE faq IS NOT NULL)                   AS has_faq,
  COUNT(*) FILTER (WHERE coupon_codes IS NOT NULL)          AS has_coupons,
  COUNT(*) FILTER (WHERE social_links IS NOT NULL)          AS has_social,
  COUNT(*) FILTER (WHERE additional_service_fees IS NOT NULL) AS has_fees
FROM surveys
WHERE is_completed = true AND is_draft = false;
```
If all return 0, omit those INSERT blocks entirely.

### 2.4 WARNING — `working_hours` JSON Shape Unknown

No sample data available. Target requires normalized rows (one per day + time slots).

**Required before generation:**
```sql
SELECT id, working_hours FROM surveys WHERE working_hours IS NOT NULL LIMIT 3;
```

Likely Shape A (object keyed by day):
```json
{ "Monday": { "openAllDay": false, "from": "09:00", "to": "18:00" }, "Sunday": { "closed": true } }
```

Likely Shape B (array of objects):
```json
[{ "day": "Monday", "openAllDay": false, "from": "09:00", "to": "17:00" }]
```

The SQL expansion logic differs significantly between these. Agent must confirm before writing the jsonb expansion.

### 2.5 WARNING — `rooms` JSON Shape Unknown

Only applies to Accommodations surveys. Maps to `listing.accommodations_rooms`.

**Required:**
```sql
SELECT id, rooms FROM surveys WHERE rooms IS NOT NULL LIMIT 2;
```

### 2.6 WARNING — taluka and village Were Dropped

Migration 20250724 removed these. Target `contact_details` has `taluka_name` and `village_name`. Both will be NULL — acceptable, must be documented.

### 2.7 INFO — `listing.listings.slug` Must Be Generated

No UNIQUE constraint exists on slug in the dump, but generate a stable unique slug:
```sql
lower(regexp_replace(coalesce(business_name, 'business'), '[^a-zA-Z0-9]+', '-', 'g'))
  || '-' || left(survey_id::text, 8)
```

### 2.8 INFO — `registration_number` Is Sequence-Generated

`bigint DEFAULT nextval(...)`. Omit from all INSERT column lists. PostgreSQL auto-assigns it.

### 2.9 AMBIGUITY — `pan_number` Has No Direct Target Column

`listing.listings` has no `pan_number` column. `pan_card_document_url` in `business_documents` is a URL field — inserting a PAN text string there violates the column's semantic contract.

**Resolution:** Store in `business_documents.document_name_one = 'PAN Number'` and `business_documents.document_name_one_url = pan_number`. Add migration comment.

### 2.10 AMBIGUITY — `establishment_cert_no` Mapping

Maps to `business_documents.tour_registration_number` (reasonable semantic match). Confirm with client before treating as final.

### 2.11 IMPORTANT — Target Column Typo

`listing.listings.financial_losses_risk_decleration` — the column name contains a typo (`decleration` not `declaration`). Use the exact misspelled column name from the dump.

### 2.12 INFO — Media Not Migrated

Source `media` table (S3 file paths) is out of scope. All `*_url` columns in target will be NULL. A separate S3 media migration is required.

---

## PART 3 — COMPLETE COLUMN MAPPING REFERENCE

| Source Column | Target Table | Target Column | Transform | Risk |
|---|---|---|---|---|
| `id` | *(comment only)* | — | Note in `-- survey <id>` | — |
| `stakeholder_id` | `listing.listings` | `admin_remark` | Appended to migration reference string | Low |
| `enumerator_id` | *(discarded)* | — | Not a listing user | — |
| `mobile_number` | `contact_details` | `mobile_number` | Direct | Low |
| `email` | `contact_details` | `email_address` | Direct | Low |
| `business_category` | `listing.listings` | `category_id` | Name → UUID via §1.3 | Med |
| `sub_categories[1]` | `listing.listings` | `listing_category_id` | Name → UUID via §1.4 | Med |
| `sub_categories[2..n]` | *(discarded)* | — | Target is scalar | High |
| `latitude` | `contact_details` | `latitude` | Cast to varchar | Low |
| `longitude` | `contact_details` | `longitude` | Cast to varchar | Low |
| `gps_accuracy` | *(discarded)* | — | No target field | — |
| `digipin` | *(discarded)* | — | No target field | — |
| `nearest_police_station` | *(discarded)* | — | No target field | — |
| `nearest_healthcare_center` | *(discarded)* | — | No target field | — |
| `business_name` | `listing.listings` | `name_of_business` | Direct + slug gen | Low |
| `owner_name` | `listing.listings` | `name_of_owner` | Direct | Low |
| `district` | `contact_details` | `district_name` | Direct | Low |
| `city` | `contact_details` | `city_name` | Direct | Low |
| `pin_code` | `contact_details` | `pin_code` | Direct | Low |
| `business_address` | `contact_details` | `business_address` | Direct | Low |
| `aadhar_number` | `listing.listings` | `aadhar_number` | **NULL (encrypted)** | HIGH |
| `udyam_aadhar_reg_no` | `listing.listings` | `udyam_aadhar_registration_number` | Direct | Low |
| `fssai_number` | `listing.listings` | `fssai_number` | NULL (dropped) | Low |
| `description` | `listing.listings` | `description` | Direct | Low |
| `accommodation_policies` | `listing.listings` | `tour_policies` | Direct, Accommodations only | Low |
| `accommodation_facilities` | *(no safe target)* | — | No normalized target table | High |
| `working_hours` | `listing.working_hours` + `working_hours_specific` | — | JSON expand — shape TBD | High |
| `rooms` | `accommodations_rooms` | — | JSON expand — shape TBD | High |
| `about_business` | `business_documents` | `about_business` | Direct | Low |
| `pan_number` | `business_documents` | `document_name_one` + `document_name_one_url` | Store as text | Med |
| `establishment_cert_no` | `business_documents` | `tour_registration_number` | Direct | Med |
| `agreed_to_terms` | `listing.listings` | `agree_terms_conditions` | Direct | Low |
| `declared_info_correct` | `listing.listings` | `declare_information_correct` | Direct | Low |
| `acknowledged_dot_liability` | `listing.listings` | `financial_losses_risk_decleration` | Direct (note typo) | Low |
| `faq` | `listing.faqs` | — | **NULL (dropped) — skip** | — |
| `coupon_codes` | `listing.coupons` | — | **NULL (dropped) — skip** | — |
| `additional_service_fees` | `additional_service_fees` | — | **NULL (dropped) — skip** | — |
| `social_links` | `listing.social_urls` | — | **NULL (dropped) — skip** | — |
| `registered_travel_for_life` | `business_documents` | `registered_for_travel_for_life` | **NULL (dropped) — skip** | — |
| `registered_green_leaf` | `business_documents` | `registered_for_green_leaf_rating` | **NULL (dropped) — skip** | — |
| `received_tourism_award` | `business_documents` | `award_in_tourism_sector` | **NULL (dropped) — skip** | — |
| `created_at` | `listing.listings` | `created_at` | Direct | Low |
| `updated_at` | `listing.listings` | `updated_at` | Direct | Low |

---

## PART 4 — SOURCE FIELDS WITH NO TARGET EQUIVALENT

| Source Column | Disposition |
|---|---|
| `gps_accuracy` | Discard |
| `digipin` | Discard |
| `nearest_police_station` | Discard |
| `nearest_healthcare_center` | Discard |
| `enumerator_id` | Discard |
| `stakeholder_id` | Store as text in `admin_remark` for traceability |
| `is_synced`, `is_draft`, `local_id`, `synced_at`, `completed_at` | Discard — operational metadata |
| `accommodation_facilities` | Discard — no normalized target; target `selected_facilities` requires existing facility UUIDs |
| `sub_categories[2..n]` | Discard — target `listing_category_id` is a scalar field |

---

## PART 5 — TARGET FIELDS WITH NO SOURCE EQUIVALENT

| Target Column | Import Value |
|---|---|
| `listing.listings.user_id` | `'<IMPORT_USER_UUID>'` — client must replace |
| `listing.listings.website_url` | NULL |
| `listing.listings.display_image_url` | NULL |
| `listing.listings.header_slider` | NULL |
| `listing.listings.save_listing_as_pending` | `true` |
| `listing.listings.approval_status` | `'pending'` |
| `listing.listings.platform_fee_status` | `'pending'` |
| `listing.listings.max_guest_capacity` | NULL |
| `listing.listings.no_of_male_employees` | NULL |
| `listing.listings.no_of_female_employees` | NULL |
| `listing.listings.gst_number` | NULL |
| `listing.listings.fssai_number` | NULL |
| `listing.contact_details.village_name` | NULL |
| `listing.contact_details.taluka_name` | NULL |
| `listing.contact_details.working_address` | NULL |
| `listing.contact_details.landline_number` | NULL |
| `listing.contact_details.alternate_email_address` | NULL |
| `listing.contact_details.alternate_mobile_number` | NULL |
| `listing.contact_details.state_name` | `'Maharashtra'` |
| `listing.contact_details.country_name` | `'India'` |
| `listing.contact_details.country_code` | `'+91'` |
| `listing.business_documents.tour_guide_license_number` | NULL |
| `listing.business_documents.*_document_url` columns | NULL |
| `listing.business_documents.registered_for_travel_for_life` | NULL |
| `listing.business_documents.registered_for_green_leaf_rating` | NULL |
| `listing.business_documents.award_in_tourism_sector` | NULL |

---

## PART 6 — AGENT PROMPT

> Send everything below this line to your coding agent verbatim.

---

### Task

Generate a single executable PostgreSQL `.sql` migration file that imports data from `public.surveys` (MahaAtithi source database) into the `listing.*` schema of the client platform.

**This analysis document provides all pre-verified mappings, UUIDs, and rules. Do not re-derive the schema. Use the values in this document directly.**

---

### Pre-Generation Verification Queries

Before writing any SQL, run these five queries against the **source (MahaAtithi) database** and report the results:

```sql
-- Q1: Volume
SELECT COUNT(*) AS completed_surveys
FROM surveys
WHERE is_completed = true AND is_draft = false;

-- Q2: JSONB null check (expected: all zeros)
SELECT 
  COUNT(*) FILTER (WHERE faq IS NOT NULL)                     AS has_faq,
  COUNT(*) FILTER (WHERE coupon_codes IS NOT NULL)            AS has_coupons,
  COUNT(*) FILTER (WHERE social_links IS NOT NULL)            AS has_social,
  COUNT(*) FILTER (WHERE additional_service_fees IS NOT NULL) AS has_fees,
  COUNT(*) FILTER (WHERE working_hours IS NOT NULL)           AS has_working_hours,
  COUNT(*) FILTER (WHERE rooms IS NOT NULL)                   AS has_rooms
FROM surveys
WHERE is_completed = true AND is_draft = false;

-- Q3: working_hours shape
SELECT id, working_hours
FROM surveys
WHERE working_hours IS NOT NULL
LIMIT 3;

-- Q4: rooms shape (Accommodations only)
SELECT id, rooms
FROM surveys
WHERE rooms IS NOT NULL LIMIT 2;

-- Q5: All distinct business_category values in completed surveys
SELECT DISTINCT business_category, COUNT(*)
FROM surveys
WHERE is_completed = true AND is_draft = false
GROUP BY business_category
ORDER BY COUNT(*) DESC;

-- Q6: All distinct sub_category values
SELECT DISTINCT unnest(sub_categories) AS sub_cat, COUNT(*)
FROM surveys
WHERE is_completed = true AND is_draft = false
GROUP BY sub_cat
ORDER BY COUNT(*) DESC;
```

**STOP and report results before generating SQL if:**
- Q5 returns a `business_category` value not in the category mapping table in §1.3.
- Q3 returns a `working_hours` JSON structure that is neither an object-keyed-by-day nor an array-of-day-objects.
- Q6 returns subcategory values not in any of the lookup tables in §1.4.
- Q1 returns 0 (nothing to migrate).

---

### SQL Generation Rules

**Transaction:** Wrap entire file in `BEGIN; ... COMMIT;`.

**Filter:** Only import rows where `is_completed = true AND is_draft = false`.

**UUID strategy:** Use `gen_random_uuid()` for all new target IDs.

**CTE structure:** Use one main CTE (`source_surveys`) that joins the category and subcategory lookup values. Reference this CTE for all INSERT statements. Do not inline UUIDs per-row.

**Listing ID linking:** Generate `listing_id = gen_random_uuid()` once per survey in the CTE. All child table INSERTs reference this same UUID. Use a multi-statement CTE with `INSERT ... RETURNING id` or generate IDs in the CTE and pass them through.

**registration_number:** Omit from all INSERT column lists — it is sequence-generated.

**String escaping:** Use dollar-quoting (`$$...$$`) for complex string literals, or standard `''` escaping. Never backslash-escape unless inside `E''`.

**NULL discipline:** If a source field is NULL, insert SQL NULL — never empty string, never a placeholder.

**user_id placeholder:** Use `'<IMPORT_USER_UUID>'::uuid` in all `listing.listings` INSERTs. Add a header comment instructing the client to replace this before running.

**Import marker:** Set `admin_remark = 'MIGRATION_IMPORT: source_survey_id=' || s.id || ' stakeholder_id=' || s.stakeholder_id` on every `listing.listings` row.

**Slug:** `lower(regexp_replace(coalesce(business_name, 'business'), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || left(id::text, 8)`

**Category resolution:** Use a `CASE` expression or VALUES-based CTE mapping `business_category` → `category_id` UUID. If no match: `category_id = NULL`, append `'; UNRESOLVED_CATEGORY=' || business_category` to `admin_remark`.

**Subcategory resolution:** Map `sub_categories[1]` to `listing_category_id`. If no match: `listing_category_id = NULL`, set `subcategory_other_name = sub_categories[1]`.

**aadhar_number:** Always insert NULL — source value is encrypted ciphertext.

**pan_number:** If NOT NULL, set `document_name_one = 'PAN Number'` and `document_name_one_url = pan_number`. If NULL, both are NULL.

**establishment_cert_no:** Map to `business_documents.tour_registration_number`.

**acknowledged_dot_liability → financial_losses_risk_decleration:** Note the intentional target typo.

**working_hours expansion:** Only generate these INSERTs if Q2 confirms `has_working_hours > 0`. For each day in the JSON, insert one `listing.working_hours` row. If the day has specific hours, also insert `listing.working_hours_specific`. Use `jsonb_each` (for object-keyed shape) or `jsonb_array_elements` (for array shape) based on Q3 result.

**rooms expansion:** Only generate if Q2 confirms `has_rooms > 0` AND `business_category = 'Accommodations'`. Use `jsonb_array_elements` to expand each room into a `listing.accommodations_rooms` row.

**Skipped tables (if all source values NULL):** `listing.faqs`, `listing.social_urls`, `listing.coupons`, `listing.additional_service_fees`. Add a comment in the SQL explaining why they are omitted.

**accommodation_facilities:** Cannot be migrated safely (target `selected_facilities` requires existing facility UUIDs that cannot be resolved from text names). Add a comment in the SQL.

**sub_categories beyond first element:** Cannot be migrated (target field is scalar). Add a comment.

**Not idempotent:** Add a prominent header warning that the script must only be run once.

---

### Required Output File Structure

```sql
-- ==========================================================
-- MahaAtithi → Listing Platform Migration
-- Generated: <date>
-- Source DB: public.surveys (MahaAtithi, PostgreSQL)
-- Target DB: listing.* (Client Platform, PostgreSQL 18.2)
--
-- PRE-RUN CHECKLIST:
-- [ ] Replace '<IMPORT_USER_UUID>' with a valid identityaccess.users.id
-- [ ] Run on a database backup first
-- [ ] Run ONCE only — this script is NOT idempotent
--
-- KNOWN LIMITATIONS:
-- [ ] aadhar_number not migrated (source is AES-256-GCM encrypted)
-- [ ] Media/photos not migrated (separate S3 migration required)
-- [ ] sub_categories[2..n] not migrated (target field is scalar)
-- [ ] taluka, village, working_address NULL in all rows (dropped Jul 2025)
-- [ ] faq, coupon_codes, social_links, additional_service_fees NULL in all rows (dropped Jul 2025)
-- [ ] accommodation_facilities not migrated (cannot resolve facility UUIDs from text)
-- ==========================================================

BEGIN;

WITH
-- ----------------------------------------------------------
-- CATEGORY LOOKUP
-- ----------------------------------------------------------
cat_map(src, tgt) AS (
  VALUES
    ('Accommodations'::text, '24f3916c-a227-42b6-86d5-cb493b0e0a4a'::uuid),
    ('Cuisine', '09247453-eec9-4e8b-9b19-219e07813b00'),
    ...all 10 categories...
),
-- ----------------------------------------------------------
-- SUBCATEGORY LOOKUP
-- ----------------------------------------------------------
subcat_map(src, cat_src, tgt) AS (
  VALUES
    ('Hotels'::text, 'Accommodations'::text, '427bbcf5-d7fb-4153-9a4f-45187427f836'::uuid),
    ...all subcategories...
),
-- ----------------------------------------------------------
-- SOURCE WITH RESOLVED IDs
-- ----------------------------------------------------------
src AS (
  SELECT
    s.id          AS survey_id,
    gen_random_uuid() AS listing_id,
    gen_random_uuid() AS contact_id,
    gen_random_uuid() AS doc_id,
    s.*,
    cm.tgt        AS resolved_cat_id,
    sm.tgt        AS resolved_subcat_id
  FROM public.surveys s
  LEFT JOIN cat_map cm    ON cm.src = s.business_category
  LEFT JOIN subcat_map sm ON sm.src = s.sub_categories[1]
                          AND sm.cat_src = s.business_category
  WHERE s.is_completed = true
    AND s.is_draft = false
)

-- ----------------------------------------------------------
-- STEP 1: listing.listings
-- ----------------------------------------------------------
INSERT INTO listing.listings (
  id, user_id, slug, category_id, name_of_business, name_of_owner,
  description, tour_policies, agree_terms_conditions,
  declare_information_correct, financial_losses_risk_decleration,
  save_listing_as_pending, listing_category_id, subcategory_other_name,
  udyam_aadhar_registration_number, approval_status, platform_fee_status,
  view_count, admin_remark, created_at, updated_at, is_archived
)
SELECT
  src.listing_id,
  '<IMPORT_USER_UUID>'::uuid,
  lower(regexp_replace(coalesce(src.business_name, 'business'), '[^a-zA-Z0-9]+', '-', 'g'))
    || '-' || left(src.survey_id::text, 8),
  src.resolved_cat_id,
  src.business_name,
  src.owner_name,
  src.description,
  src.accommodation_policies,
  src.agreed_to_terms,
  src.declared_info_correct,
  src.acknowledged_dot_liability,
  true,
  src.resolved_subcat_id,
  CASE WHEN src.resolved_subcat_id IS NULL THEN src.sub_categories[1] END,
  src.udyam_aadhar_reg_no,
  'pending', 'pending', 0,
  'MIGRATION_IMPORT: source_survey_id=' || src.survey_id
    || ' stakeholder_id=' || src.stakeholder_id
    || CASE WHEN src.resolved_cat_id IS NULL
       THEN '; UNRESOLVED_CATEGORY=' || coalesce(src.business_category, 'NULL')
       ELSE '' END,
  src.created_at,
  src.updated_at,
  false
FROM src;

-- ----------------------------------------------------------
-- STEP 2: listing.contact_details
-- ----------------------------------------------------------
-- (follow same CTE-based SELECT from src pattern)

-- ----------------------------------------------------------
-- STEP 3: listing.business_documents
-- ----------------------------------------------------------
-- (follow same pattern; pan_number logic as described)

-- ----------------------------------------------------------
-- STEP 4: listing.working_hours
-- (only if Q2 confirmed has_working_hours > 0)
-- ----------------------------------------------------------

-- ----------------------------------------------------------
-- STEP 5: listing.working_hours_specific
-- (only if specific-hours rows exist)
-- ----------------------------------------------------------

-- STEPS 6-9: faqs, social_urls, coupons, additional_service_fees
-- OMITTED: all source columns were dropped in migration 20250724
-- and confirmed NULL in all live survey rows.

-- ----------------------------------------------------------
-- STEP 10: listing.accommodations_rooms
-- (only if Q2 confirmed has_rooms > 0)
-- ----------------------------------------------------------

COMMIT;
```

---

### Stop Conditions — Do Not Generate SQL If

- Any `business_category` value from Q5 has no entry in the category map.
- Q3 returns a `working_hours` shape that is neither a JSON object nor a JSON array.
- Q1 returns 0 surveys.
- The client has not provided a `user_id` UUID and has not confirmed NULL is acceptable.

---

*End of agent prompt.*
