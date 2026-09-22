-- Survey.gstNumber: GST is now asked directly on the survey form, immediately
-- below the PAN Card field, per request. Nullable and optional like the other
-- survey ID fields (aadhar, udyam, pan). Catalogue-only change — nullable with no
-- default — so no rewrite of the surveys table.
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "gst_number" TEXT;
