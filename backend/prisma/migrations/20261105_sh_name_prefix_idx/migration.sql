-- ============================================================================
-- Name suggestions: prefix lookup, already in alphabetical order
-- ============================================================================
-- Serves the first half of the "suggestions as you type" query:
--
--   WHERE lower(company_name_standardized) COLLATE "C" LIKE 'sai%'
--   ORDER BY lower(company_name_standardized) COLLATE "C" LIMIT 8
--
-- Measured on the live data (temporary copy): 0.07 ms, reading 8 index entries and
-- stopping. COLLATE "C" matters. The same query on a text_pattern_ops index still had to
-- sort every match: 31 ms, and it grows with how common the prefix is.
-- Size about 9 MB.
--
-- HOW TO RUN: one statement, outside a transaction (see 20261105_sh_name_key_district_idx).
-- To undo:  DROP INDEX CONCURRENTLY IF EXISTS stakeholders_name_prefix_idx;
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS "stakeholders_name_prefix_idx"
  ON "stakeholders" ((lower("company_name_standardized") COLLATE "C"));
