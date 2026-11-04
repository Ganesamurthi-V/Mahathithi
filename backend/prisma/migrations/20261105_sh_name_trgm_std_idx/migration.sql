-- ============================================================================
-- Trigram index on the standardized name: fast "contains" search
-- ============================================================================
-- Without it, every name search that is not a prefix (ILIKE '%mizan%') reads the whole
-- table. Measured on the live table: 5.6 SECONDS for a rare word. With this index the same
-- search is a bitmap index lookup: about 3 ms on a temporary copy of the names.
--
-- It serves both the suggestions endpoint and the existing Stakeholders-list name filter
-- (company name ILIKE %x%) with no change to that code.
--
-- Trigram indexes need at least 3 characters in the pattern; the application only uses the
-- "contains" search from 3 characters up and uses the prefix index below that.
-- Size about 16 MB. pg_trgm is already installed (public schema), so gin_trgm_ops resolves.
--
-- HOW TO RUN: one statement, outside a transaction (see 20261105_sh_name_key_district_idx).
-- To undo:  DROP INDEX CONCURRENTLY IF EXISTS stakeholders_name_trgm_std_idx;
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS "stakeholders_name_trgm_std_idx"
  ON "stakeholders" USING gin ("company_name_standardized" gin_trgm_ops);
