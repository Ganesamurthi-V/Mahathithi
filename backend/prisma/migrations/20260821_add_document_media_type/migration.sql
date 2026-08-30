-- Add DOCUMENT to the MediaType enum so uploaded documents (PDF/Word/etc.) are
-- classified distinctly from photos and videos. Previously documents were stored
-- with type = 'PHOTO', which made them indistinguishable from real photos.
--
-- NOTE: In PostgreSQL a new enum value added with ALTER TYPE ... ADD VALUE
-- cannot be used in the SAME transaction that adds it. Run the two statements
-- below separately (Supabase's SQL editor runs each statement in its own
-- transaction, so pasting both is fine there).

ALTER TYPE "MediaType" ADD VALUE IF NOT EXISTS 'DOCUMENT';

-- Backfill: reclassify existing rows that are documents but were saved as PHOTO.
UPDATE media
SET type = 'DOCUMENT'
WHERE type = 'PHOTO'
  AND photo_category IN (
    'GST_DOC', 'PAN_CARD_DOC', 'ESTABLISHMENT_CERT_DOC', 'CUSTOM_DOC',
    'UDYOG_AADHAR_DOC', 'AADHAR_CARD_DOC', 'CANCELLED_CHEQUE_DOC'
  );
