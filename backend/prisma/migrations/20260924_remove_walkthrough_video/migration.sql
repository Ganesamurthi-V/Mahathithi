-- Remove the walkthrough / verification video feature.
--
-- The video was the ONLY consumer of the media.duration and media.thumbnail_path
-- columns (duration in seconds + a video thumbnail). With the feature gone, both
-- columns are dead metadata, so they are dropped.
--
-- The 'VIDEO' value of the MediaType enum is intentionally NOT dropped:
-- PostgreSQL cannot remove an enum value while existing rows still reference it,
-- and older surveys may still carry VIDEO media rows. The application no longer
-- creates, uploads, validates, or displays VIDEO media, so leaving the value in
-- place is harmless and keeps historical rows valid.

ALTER TABLE "media" DROP COLUMN IF EXISTS "duration";
ALTER TABLE "media" DROP COLUMN IF EXISTS "thumbnail_path";
