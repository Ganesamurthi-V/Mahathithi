-- ============================================================================
-- Trigram index on the original name
-- ============================================================================
-- The Stakeholders list matches a typed name against BOTH name columns:
--   company_name_standardized ILIKE '%x%'  OR  company_name_original ILIKE '%x%'
-- An OR can only use an index when both sides have one, so without this the standardized
-- index alone does not help that search. Together they let Postgres combine two index
-- lookups instead of reading the table.
--
-- Size about 16 MB.
--
-- HOW TO RUN: one statement, outside a transaction (see 20261105_sh_name_key_district_idx).
-- To undo:  DROP INDEX CONCURRENTLY IF EXISTS stakeholders_name_trgm_orig_idx;
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS "stakeholders_name_trgm_orig_idx"
  ON "stakeholders" USING gin ("company_name_original" gin_trgm_ops);
