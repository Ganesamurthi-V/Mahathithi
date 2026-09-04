-- ============================================================================
-- PERFORMANCE: make the nicCode search filter cost-flat
-- ============================================================================
--
-- ALREADY APPLIED to the live database on 2026-09-04 (CONCURRENTLY, 18 MB, 12.8 s).
-- This file records it so schema history matches production.
--
-- THE PROBLEM
-- Unlike the category filter, this one was ALREADY using an index-friendly
-- operator — `nicCode: { equals: value }`, compiling to `nic_code = $1`, with a
-- b-tree on nic_code available. It was still slow, because nic_code has only 11
-- distinct values across 295,176 rows, so no single-column index on it is
-- selective enough for the planner to prefer over walking idx_sh_list_global to
-- satisfy `ORDER BY priority_weight DESC, company_name_standardized ASC LIMIT 20`.
--
-- The result was wildly unpredictable cost, depending entirely on where matching
-- rows happened to fall in priority order:
--
--   nic_code    rows              BEFORE buffers    AFTER buffers
--   79110       135,869 (46%)             34,412               23
--   55101        50,468 (17%)            155,073               23
--   79900        21,232 (7%)               2,252               23
--   55902         2,190 (0.7%)                37               23
--   55200         1,136 (0.4%)            17,092               23
--
-- Two rows apart in selectivity differed by 4,000x in I/O — 55902 cost 37 buffers
-- while the *less* selective 55101 cost 155,073.
--
-- THE FIX
-- A composite index leading with nic_code and continuing with exactly the list's
-- ORDER BY columns. The planner can then seek straight to the matching nic_code and
-- walk pre-sorted, so it reads 20 index entries and stops — no filtering, no sort,
-- and identical cost for every value. Cost is now flat at 23 buffers.
--
-- No application change was needed: the filter operator was already correct.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sh_nic_list
  ON stakeholders (nic_code, priority_weight DESC, company_name_standardized);

ANALYZE stakeholders;

-- stakeholders_nic_code_idx (nic_code) is now redundant: the composite above serves
-- every query the single-column index could, because (nic_code) is its prefix. It
-- had 73 scans, so it WAS being used — it is safe to drop only because the
-- replacement strictly supersedes it. Dropped after confirming the new index built
-- with indisvalid = true; a failed CONCURRENTLY build leaves an INVALID index that
-- the planner ignores, which would have left no usable index at all.
DROP INDEX CONCURRENTLY IF EXISTS stakeholders_nic_code_idx;

ANALYZE stakeholders;

-- Verified live afterwards: all five nic_code values return in ~770-825 ms
-- end-to-end (from 4,534 ms), each using idx_sh_nic_list, and the unfiltered,
-- name, district, category and status filters were re-checked unchanged.
--
-- To reverse:
--   CREATE INDEX CONCURRENTLY stakeholders_nic_code_idx ON stakeholders (nic_code);
--   DROP INDEX CONCURRENTLY idx_sh_nic_list;
