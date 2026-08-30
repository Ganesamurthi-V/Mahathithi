# MahaAtithi `media` Table → Client DB Mapping

## Source: How we store a media record

```json
{
  "idx": 17,
  "id": "a5884536-3143-453b-8a8c-92153c7f5aff",
  "survey_id": "ec2ac57e-d330-466e-bb6c-5760d24ab734",
  "type": "DOCUMENT",
  "photo_category": "ESTABLISHMENT_CERT_DOC",
  "file_path": "photos/2026-08-26/ec2ac57e-d330-466e-bb6c-5760d24ab734/0806f325-22c1-4510-8271-a82231dab81e.jpg",
  "file_url": "https://mahaathithi-media.s3.ap-south-1.amazonaws.com/...?X-Amz-Expires=3600&...",
  "file_name": "46f0c2ca-b6ae-4810-bbe7-a841f7d4881a.jpg",
  "file_size": 4931045,
  "mime_type": "image/jpeg",
  ...
}
```

**Never use `file_url`** — it contains `X-Amz-Expires=3600` and expires in 1 hour.

**Never use `file_path` bare** — it's just the S3 object key, not a usable URL.

**Always construct the permanent public URL:**
```
https://mahaathithi-media.s3.ap-south-1.amazonaws.com/<file_path>
```

Example:
```
file_path  → photos/2026-08-26/ec2ac57e-.../0806f325-...jpg
export URL → https://mahaathithi-media.s3.ap-south-1.amazonaws.com/photos/2026-08-26/ec2ac57e-.../0806f325-...jpg
```

This is a permanent, non-expiring URL. The client can access the file directly from your S3 bucket using this link as long as the bucket policy allows public read on that prefix.

---

## Media Query (run per survey before generating SQL)

```sql
SELECT type, photo_category, file_path
FROM media
WHERE survey_id = '<survey_uuid>'
  AND deleted_at IS NULL
  AND type IN ('PHOTO', 'DOCUMENT')
ORDER BY created_at ASC;
```

In `generateExportSQL()`, construct the permanent URL from `file_path` before writing to SQL:

```js
const S3_BASE_URL = 'https://mahaathithi-media.s3.ap-south-1.amazonaws.com';

function buildMediaUrl(filePath) {
  if (!filePath) return null;
  return `${S3_BASE_URL}/${filePath}`;
}
```

The exported types and their mapped categories:

| `type` | Exported `photo_category` values |
|---|---|
| `PHOTO` | `BUILDING_FRONT` |
| `DOCUMENT` | `GST_CERT_DOC`, `PAN_CARD_DOC`, `ESTABLISHMENT_CERT_DOC` |

---

## Complete `photo_category` → Client Target Mapping

Every `photo_category` value we collect, and exactly where it goes in the client DB:

### 1. `BUILDING_FRONT` (type: PHOTO)

| | |
|---|---|
| **Target table** | `listing.listings` |
| **Target column** | `display_image_url` |
| **Value** | Permanent URL constructed from first BUILDING_FRONT `file_path` |
| **Rule** | Take only the first one (ORDER BY created_at ASC). Construct: `https://mahaathithi-media.s3.ap-south-1.amazonaws.com/<file_path>` |
| **SQL** | Set during the `INSERT INTO listing.listings` CTE |

---

### 2. `GST_CERT_DOC` (type: DOCUMENT)

| | |
|---|---|
| **Target table** | `listing.business_documents` |
| **Target columns** | `document_name_one` = `'GST Certificate'`, `document_name_one_url` = permanent S3 URL |
| **Rule** | Uses custom document slot 1. Always label it `'GST Certificate'`. |
| **Conflict** | If both GST_CERT_DOC and another document need slot 1, GST takes priority. |

---

### 3. `PAN_CARD_DOC` (type: DOCUMENT)

| | |
|---|---|
| **Target table** | `listing.business_documents` |
| **Target column** | `pan_card_document_url` = permanent S3 URL |
| **Rule** | Dedicated column — no slot conflict. |

---

### 4. `ESTABLISHMENT_CERT_DOC` (type: DOCUMENT)

| | |
|---|---|
| **Target table** | `listing.business_documents` |
| **Target columns** | `document_name_two` = `'Establishment Certificate'`, `document_name_two_url` = permanent S3 URL |
| **Rule** | Uses custom document slot 2. |

---

## Summary Table

| `photo_category` | `type` | Target Table | Target Column | Status |
|---|---|---|---|---|
| `BUILDING_FRONT` | PHOTO | `listing.listings` | `display_image_url` | ✅ First record only |
| `GST_CERT_DOC` | DOCUMENT | `listing.business_documents` | `document_name_one` + `document_name_one_url` | ✅ Slot 1 |
| `PAN_CARD_DOC` | DOCUMENT | `listing.business_documents` | `pan_card_document_url` | ✅ Dedicated column |
| `ESTABLISHMENT_CERT_DOC` | DOCUMENT | `listing.business_documents` | `document_name_two` + `document_name_two_url` | ✅ Slot 2 |

---

## Fields to NEVER export from `media`

These fields exist in our DB but must not appear in the generated SQL:

| Field | Reason |
|---|---|
| `file_url` | Contains expiring presigned URL (`X-Amz-Expires=3600`) — construct permanent URL from `file_path` instead |
| `file_path` (bare) | Not a usable URL — always prefix with `https://mahaathithi-media.s3.ap-south-1.amazonaws.com/` before exporting |
| `file_size` | Internal metadata |
| `latitude` / `longitude` / `gps_accuracy` | Internal capture metadata |
| `captured_at` | Internal |
| `duration` | Internal |
| `thumbnail_path` | Internal |
| `is_synced` / `synced_at` / `local_id` | Internal sync fields |
| `id` (media row id) | Not referenced by client schema |
| `file_name` | Client uses `file_path` as reference |
| `mime_type` | Client schema doesn't store this |
| `digipin` | Internal |

---

## How to integrate into `generateExportSQL()` CTE

```sql
-- Fetch media for this survey first (in application code):
-- SELECT type, photo_category, file_path FROM media
-- WHERE survey_id = '<id>' AND deleted_at IS NULL
-- AND type IN ('PHOTO', 'DOCUMENT')
-- ORDER BY created_at ASC
--
-- Then in application code, construct permanent URLs:
--   const url = `https://mahaathithi-media.s3.ap-south-1.amazonaws.com/${record.file_path}`
--
-- Split by type:
--   type = 'PHOTO'    → BUILDING_FRONT → display_image_url
--   type = 'DOCUMENT' → GST_CERT_DOC, PAN_CARD_DOC, ESTABLISHMENT_CERT_DOC → business_documents

-- Then in the CTE (all URL values are permanent S3 URLs, not file_path or presigned URLs):

WITH new_listing AS (
  INSERT INTO listing.listings (
    ...,
    display_image_url,   -- ← 'https://mahaathithi-media.s3.ap-south-1.amazonaws.com/<file_path>'
    ...
  )
  VALUES (
    ...,
    'https://mahaathithi-media.s3.ap-south-1.amazonaws.com/photos/2026-08-26/.../file.jpg',
    ...
  )
  RETURNING id
),

new_doc AS (
  INSERT INTO listing.business_documents (
    id, listing_id,
    pan_card_document_url,    -- ← permanent S3 URL for PAN_CARD_DOC
    document_name_one,        -- ← 'GST Certificate' (if GST_CERT_DOC exists, else NULL)
    document_name_one_url,    -- ← permanent S3 URL for GST_CERT_DOC
    document_name_two,        -- ← 'Establishment Certificate' (if ESTABLISHMENT_CERT_DOC exists, else NULL)
    document_name_two_url,    -- ← permanent S3 URL for ESTABLISHMENT_CERT_DOC
    ...
  )
  SELECT gen_random_uuid(), id,
    'https://mahaathithi-media.s3.ap-south-1.amazonaws.com/photos/.../pan.jpg',
    'GST Certificate',
    'https://mahaathithi-media.s3.ap-south-1.amazonaws.com/photos/.../gst.jpg',
    'Establishment Certificate',
    'https://mahaathithi-media.s3.ap-south-1.amazonaws.com/photos/.../estab.jpg',
    ...
  FROM new_listing
)
```

---

## Important Notes for Claude Code

1. **Permanent URL construction** — always build the URL as `https://mahaathithi-media.s3.ap-south-1.amazonaws.com/<file_path>`. The client accesses files directly from your S3 bucket using this link. Ensure the S3 bucket policy allows public read (or the client's IP/account has access) on the `photos/` prefix.

2. **Never export `file_url`** — the presigned URL from the DB expires in 1 hour and will be dead by the time the client imports the SQL.

3. **`header_slider`** — `listing.listings` has a `header_slider varchar` column. No source field maps to it. Leave it NULL.

3. **`events_festivals_performers.image_url`** — this is a performer headshot, not a survey media record. Map from survey data structure if a performer image exists, not from the generic media table.