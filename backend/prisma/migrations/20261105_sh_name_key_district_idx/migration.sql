-- ============================================================================
-- Duplicate-name check index
-- ============================================================================
-- Serves the check run when a stakeholder is created or renamed:
--
--   WHERE sh_name_key(company_name_standardized, company_name_original) = sh_name_key($name, NULL)
--     AND lower(btrim(district)) = lower($district)
--
-- Measured on the live data (295 000 rows, on a temporary copy): 2 ms, an index scan.
-- Size about 11 MB.
--
-- REQUIRES 20261105_sh_name_key_function. District is compared lower-cased and trimmed so
-- a differently-typed district ("pune ") still finds the record.
--
-- HOW TO RUN: CREATE INDEX CONCURRENTLY does not block reads or writes, but cannot run inside a
-- transaction, so run THIS ONE statement on its own. The easiest way is
--     npx tsx scripts/create-name-indexes.ts
-- which runs all the name indexes one at a time and checks each came out valid.
-- To undo:  DROP INDEX CONCURRENTLY IF EXISTS stakeholders_name_key_district_idx;
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS "stakeholders_name_key_district_idx"
  ON "stakeholders" ((sh_name_key("company_name_standardized", "company_name_original")), (lower(btrim("district"))));
