-- ============================================================================
-- Claim pool index: makes POST /stakeholders/claim fast
-- ============================================================================
--
-- Claiming work reads the unassigned pool of one district in priority order:
--
--   SELECT id FROM stakeholders
--   WHERE assigned_to_id IS NULL AND status = 'OPEN' AND district = $d
--   ORDER BY priority_weight DESC NULLS LAST, primary_key_id ASC
--   LIMIT $n  FOR UPDATE SKIP LOCKED
--
-- No existing index serves it. Postgres walks every OPEN row of the district through
-- stakeholders_status_district_idx (about 43 500 entries for Mumbai Suburban),
-- discards the ones that are already assigned, and sorts the rest. Measured on the
-- live database: 2 714 ms of database time for ONE district, and a claim runs it once
-- per district. That is why POST /stakeholders/claim took 10 to 17 seconds.
--
-- This partial index holds only the rows that can still be claimed, already in claim
-- order, so the query reads the first N entries and stops. The same query against a
-- copy of that district's rows with this index: 1.5 ms.
--
-- It stays small and cheap to maintain: a row leaves the index the moment it is
-- claimed, so it only ever holds the unassigned pool.
--
-- HOW TO RUN
-- CREATE INDEX CONCURRENTLY does not block reads or writes, so field devices keep
-- working while it builds (expect well under a minute for ~295 000 rows). It cannot
-- run inside a transaction, so run this ONE statement on its own, for example in the
-- Supabase SQL editor, and not together with other statements. IF NOT EXISTS makes a
-- second run harmless. If it is interrupted it leaves an INVALID index behind: drop it
-- with  DROP INDEX CONCURRENTLY IF EXISTS stakeholders_claim_pool_idx;  and run again.
--
-- To undo:  DROP INDEX CONCURRENTLY IF EXISTS stakeholders_claim_pool_idx;
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS "stakeholders_claim_pool_idx"
  ON "stakeholders" ("district", "priority_weight" DESC NULLS LAST, "primary_key_id")
  WHERE "assigned_to_id" IS NULL AND "status" = 'OPEN';
