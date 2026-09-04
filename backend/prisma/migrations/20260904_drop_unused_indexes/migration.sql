-- ============================================================================
-- PERFORMANCE: drop 13 provably-useless indexes on stakeholders (291 MB -> 180 MB)
-- ============================================================================
--
-- ALREADY APPLIED to the live database on 2026-09-04 via
-- backend/scripts/drop-unused-indexes.ts (DROP INDEX CONCURRENTLY, no locks).
-- This file records it so schema history matches production.
--
-- WHY THE DECISION IS SOUND NOW
-- The 20260830 migration listed most of these as candidates but deliberately left
-- them, because idx_scan counters reset on restart and it did not want to remove
-- indexes "on the strength of counters that reset". That caveat no longer applies:
--
--   pg_stat_database.stats_reset = NULL      (statistics never reset)
--   uptime                       = 45 days
--
-- So idx_scan = 0 means unused across 45 days of real production traffic.
--
-- Each drop below is additionally justified by something stronger than a counter:
--
--   A. The indexed column is 100% NULL, so the index holds nothing that can match:
--        gst_number      0 distinct    company_status  0 distinct
--        taluka          0 distinct
--
--   B. The leading column has ONE distinct value ('Maharashtra'), giving zero
--      selectivity, so any composite starting with it is strictly worse than the
--      equivalent index on its second column:
--        state           1 distinct
--
--   C. No application query references the column. StakeholderService.search()
--      accepts name, org, state, district, pinCode, category, nicCode, gst,
--      taluka, city, status, digipin — `full_address_raw` is not among them, so a
--      59 MB trigram index on it backed nothing. It was the largest index here.
--
--   D. The filter is ILIKE '%x%', which a btree cannot serve; those paths are
--      served by the GIN trigram indexes, which are kept.
--
-- KEPT despite 0 scans, because each backs a filter the UI exposes AND can use:
--   stakeholders_pin_code_idx   — pinCode uses startsWith, a btree serves that
--   idx_stakeholders_city_trgm  — city uses ILIKE, the trigram serves that
--
-- VERIFIED AFTER: all 10 exposed search filters plus analytics, districts,
-- enumerators and the export list were exercised against production; no regression.
-- Index total 291 MB -> 180 MB, count 28 -> 15, planning 0.77 ms -> 0.69 ms.
--
-- NOTE: run with CONCURRENTLY (as the script does) to avoid taking a lock. Plain
-- DROP INDEX briefly takes an ACCESS EXCLUSIVE lock on the table.

DROP INDEX CONCURRENTLY IF EXISTS stakeholders_gst_number_idx;                          -- 3.0 MB, gst_number all NULL
DROP INDEX CONCURRENTLY IF EXISTS idx_sh_gst_trgm;                                      -- 2.4 MB, gst_number all NULL
DROP INDEX CONCURRENTLY IF EXISTS stakeholders_company_status_idx;                       -- 3.0 MB, company_status all NULL
DROP INDEX CONCURRENTLY IF EXISTS stakeholders_taluka_idx;                               -- 3.0 MB, taluka all NULL
DROP INDEX CONCURRENTLY IF EXISTS stakeholders_state_idx;                                -- 3.3 MB, state has 1 value
DROP INDEX CONCURRENTLY IF EXISTS stakeholders_state_district_idx;                       -- 3.5 MB, leads with state
DROP INDEX CONCURRENTLY IF EXISTS stakeholders_state_category_idx;                       -- 3.4 MB, leads with state
DROP INDEX CONCURRENTLY IF EXISTS idx_stakeholders_address_trgm;                          -- 59.3 MB, column never queried
DROP INDEX CONCURRENTLY IF EXISTS stakeholders_company_name_standardized_district_idx;    -- 16.9 MB, name search is ILIKE
DROP INDEX CONCURRENTLY IF EXISTS stakeholders_category_idx;                              -- 2.9 MB, category filter is ILIKE
DROP INDEX CONCURRENTLY IF EXISTS stakeholders_district_category_idx;                     -- 3.5 MB, category half is ILIKE
DROP INDEX CONCURRENTLY IF EXISTS stakeholders_city_idx;                                  -- 3.3 MB, city filter is ILIKE
DROP INDEX CONCURRENTLY IF EXISTS stakeholders_district_pin_code_idx;                     -- 3.8 MB, redundant

ANALYZE stakeholders;

-- ============================================================================
-- SEPARATE PRE-EXISTING ISSUE FOUND WHILE VERIFYING — NOT FIXED HERE
-- ============================================================================
-- The `category` search filter costs 155,073 buffers (~1.2 GB) for 20 rows,
-- because Prisma's `contains` + mode:'insensitive' compiles to ILIKE '%x%'. The
-- planner then walks idx_sh_list_global in priority order and discards 154,276
-- rows.
--
-- Proven NOT caused by dropping stakeholders_category_idx: restoring that index
-- inside a transaction produced a byte-identical plan and the same 155,073
-- buffers. A btree cannot serve a leading-wildcard match, which is also why it had
-- 0 scans in 45 days. A GIN trigram on category does not help either — same plan.
--
-- `category` holds only 12 distinct values; it is enum-like, so ILIKE is the wrong
-- operator. Measured fix, exact match plus a composite index:
--
--     WHERE category = 'Hotels & Resorts'
--     + CREATE INDEX ON stakeholders (category, priority_weight DESC,
--                                     company_name_standardized)
--     -> 23 buffers, 4 ms   (from 155,073 buffers)
--
-- Left alone because switching `contains` to `equals` changes the API contract:
-- today `category=Hotels` matches 'Hotels & Resorts', and afterwards it would not.
-- The admin UI does not expose a category filter, so the blast radius looks small,
-- but it is a behaviour change rather than a pure optimisation.
