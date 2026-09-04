-- ============================================================================
-- PERFORMANCE: finish making `GROUP BY district` an index-only scan
-- ============================================================================
--
-- CONTEXT
-- The dashboard/districts aggregate was taking ~3.6 s. The dominant cause was in
-- application code, not the database: Prisma's `_count: { id: true }` emits
-- COUNT(id), and because `id` is not in stakeholders_district_idx (district),
-- Postgres could not use an index-only scan and fell back to a full table scan.
--
--   COUNT(id) GROUP BY district  -> Parallel Seq Scan        3025 ms, 15647 buffers
--   COUNT(*)  GROUP BY district  -> Parallel Index Only Scan  452 ms,  3657 buffers
--
-- That is already fixed in backend/src/modules/admin/admin.routes.ts by switching
-- to `_count: true` (COUNT(*)) and dropping the ORDER BY COUNT(id).
--
-- WHAT THIS FILE IS FOR
-- Even the index-only scan performed ~34,850 heap fetches, because the table is
-- only ~88.2% "all-visible" (13,797 of 15,646 pages). An index-only scan may skip
-- the heap only for pages the visibility map marks all-visible, so the remaining
-- ~12% still cost random I/O.
--
-- Measured before running this:
--   relpages 15646 | relallvisible 13797 | pct_all_visible 88.2
--   last_vacuum: never | last_autovacuum: 2026-07-24
--
-- A vacuum rebuilds the visibility map and should take pct_all_visible to ~100,
-- removing most of those heap fetches.
--
-- ============================================================================
-- IMPORTANT: VACUUM CANNOT RUN INSIDE A TRANSACTION BLOCK
-- ============================================================================
-- The Supabase SQL editor wraps submissions in a transaction, so pasting this
-- there fails with:
--     ERROR: 25001: VACUUM cannot run inside a transaction block
--
-- Run it from a client that does not wrap statements in a transaction — psql, or
-- any terminal with the connection string:
--
--     psql "$DATABASE_URL" -c "VACUUM (ANALYZE, VERBOSE) stakeholders;"
--
-- SAFETY: this is plain VACUUM, not VACUUM FULL. It runs online, takes no
-- exclusive lock, and blocks neither reads nor writes. VACUUM FULL would rewrite
-- the table and hold an ACCESS EXCLUSIVE lock — do not use it here.
-- Expect roughly 10-30 s on 295K rows.

VACUUM (ANALYZE, VERBOSE) stakeholders;

-- ----------------------------------------------------------------------------
-- Keep it that way.
-- ----------------------------------------------------------------------------
-- This table is written in large bulk imports and then read constantly. Default
-- autovacuum thresholds scale with table size (20% of 295K rows = ~59K changes
-- before autovacuum considers it), which is why last_autovacuum was months old
-- and the visibility map had drifted. Lowering the scale factors makes autovacuum
-- act sooner after an import, keeping the aggregate on its fast plan.
--
-- Unlike VACUUM itself, ALTER TABLE is transactional and is safe to run in the
-- Supabase SQL editor.
ALTER TABLE stakeholders SET (
  autovacuum_vacuum_scale_factor = 0.05,   -- vacuum after ~5% of rows change
  autovacuum_analyze_scale_factor = 0.02   -- re-analyze after ~2%
);

-- Verify afterwards: pct_all_visible should now be at or near 100.
--   SELECT relpages, relallvisible,
--          round(100.0 * relallvisible / NULLIF(relpages, 0), 1) AS pct_all_visible
--   FROM pg_class WHERE relname = 'stakeholders';
