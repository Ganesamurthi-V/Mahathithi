-- ============================================================================
-- PERFORMANCE: make district-scoped reads index-driven, and cut index bloat
-- ============================================================================
--
-- SAFE TO RUN REPEATEDLY. Every statement uses IF NOT EXISTS / IF EXISTS, so
-- re-running is a no-op. Paste the whole file into the Supabase SQL editor.
--
-- Verified state after applying: 27 indexes totalling 224 MB (down from 32 /
-- 288 MB), and the stakeholder list query planning to
-- "Index Scan using idx_sh_list_hot ... no sort" at 0.1 ms execution.
--
-- MEASURED PROBLEM
-- Every stakeholder query is district-scoped. Those filters used Prisma's
-- `mode: 'insensitive'`, which compiles to:
--     WHERE LOWER(district) IN (LOWER($1), LOWER($2))
-- No b-tree index on `district` can serve that expression, so Postgres ran a
-- Parallel Seq Scan over all 295,176 rows on every request.
--
--   list query, LOWER(district)  -> Parallel Seq Scan   422 ms warm / 3423 ms cold
--   list query, exact match      -> Index Scan            90 ms
--   list query, exact + new idx  -> Index Scan, no sort  0.22 ms
--
-- The application side is fixed in backend/src/utils/district-scope.ts, which
-- resolves the canonical spelling from the districts table and then filters
-- exactly. Verified safe first: all 36 distinct districts.name values match
-- stakeholders.district byte-for-byte, no casing or whitespace differences.
--
-- 1. ADD THE INDEX THAT SUPPLIES THE SORT ORDER
--    The hot query is:
--        WHERE district = $1
--        ORDER BY priority_weight DESC, company_name_standardized ASC
--        LIMIT 20
--    With this index the planner walks it in order and stops after 20 entries,
--    so cost no longer scales with district size — 'Pune' (81,164 rows) returns
--    in the same 0.2 ms as 'Sindhudurg' (1,999 rows).
--
--    Column order and NULLS handling both matter. The pre-existing
--    idx_sh_district_priority was (district, priority_weight DESC NULLS LAST),
--    but Prisma emits plain `DESC`, which in Postgres means NULLS FIRST. That
--    mismatch is why it had 0 scans despite looking correct.
--
--    NOTE ON LOCKING: this deliberately does NOT use CONCURRENTLY, because the
--    Supabase SQL editor runs your whole submission inside a single transaction
--    and Postgres rejects CREATE INDEX CONCURRENTLY there:
--        ERROR 25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
--    A plain CREATE INDEX takes a ShareLock on stakeholders, which blocks writes
--    (not reads) while it builds — about 7 seconds on 295K rows. That is fine for
--    this table: it is written by bulk imports and by survey completion, not by a
--    constant stream of traffic.
--
--    If you would rather not block writes at all, skip this file in the editor and
--    run the statement below from psql or any client that does NOT wrap it in a
--    transaction, then run the rest of this file in the editor:
--        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sh_list_hot
--          ON stakeholders (district, priority_weight DESC, company_name_standardized);
CREATE INDEX IF NOT EXISTS idx_sh_list_hot
  ON stakeholders (district, priority_weight DESC, company_name_standardized);

-- 2. DROP EXACT DUPLICATE INDEXES
--    Identical method and identical columns to an index that is kept, so these
--    can never be the only way to serve a query. Two GIN trigram indexes on the
--    same column are pure overhead: both get updated on every write.
--      idx_sh_name_std_trgm   duplicates idx_stakeholders_name_std_trgm
--      idx_sh_name_orig_trgm  duplicates idx_stakeholders_name_orig_trgm
--      idx_sh_city_trgm       duplicates idx_stakeholders_city_trgm
DROP INDEX IF EXISTS idx_sh_name_std_trgm;    -- 18 MB
DROP INDEX IF EXISTS idx_sh_name_orig_trgm;   -- 18 MB
DROP INDEX IF EXISTS idx_sh_city_trgm;        -- 3.6 MB

-- 3. DROP INDEXES THAT CANNOT SERVE THIS APPLICATION'S SORT
--    Both index `priority_weight DESC NULLS LAST`. Every ORDER BY in the app is
--    plain `DESC` (NULLS FIRST), so neither can ever supply the ordering, and
--    both show 0 scans. idx_sh_district_priority is additionally superseded by
--    idx_sh_list_hot above, which has the correct NULLS behaviour plus the
--    tiebreaker column.
DROP INDEX IF EXISTS idx_sh_priority_sort;      -- 16 MB, 0 scans
DROP INDEX IF EXISTS idx_sh_district_priority;  -- 10 MB, 0 scans

-- Refresh planner statistics so it costs the new index correctly.
ANALYZE stakeholders;

-- ============================================================================
-- NOT DONE HERE, BUT WORTH REVIEWING
-- ============================================================================
-- stakeholders is 122 MB of data carrying 288 MB of indexes across 32 indexes,
-- of which ~223 MB has never been scanned. Every one of them is updated on each
-- of the 295K upserts during a bulk import, which is a large part of why the
-- initial sync is slow.
--
-- These are all 0-scan and are candidates, but each backs a filter the admin
-- search exposes, so they were left in place rather than removed on the strength
-- of counters that reset on restart. Confirm against real admin usage first:
--   stakeholders_company_name_standardized_district_idx  16 MB
--   stakeholders_state_idx / _state_category_idx / _state_district_idx  ~8 MB
--   stakeholders_district_category_idx                    2.6 MB
--   stakeholders_district_pin_code_idx                    3.0 MB
--   stakeholders_city_idx / _category_idx / _gst_number_idx / _company_status_idx
--   idx_sh_gst_trgm
