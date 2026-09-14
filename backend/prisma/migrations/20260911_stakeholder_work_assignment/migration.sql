-- ============================================================================
-- WORK ASSIGNMENT: give each stakeholder an owning enumerator
-- ============================================================================
--
-- WHY
-- Each enumerator must hold a bounded, exclusive set of stakeholders to survey
-- (5000), and top that set up from the unassigned pool in their districts as they
-- work through it.
--
-- This replaces a DERIVED partition: the caller's share of a district was computed
-- as `primary_key_id % n = k`, where n was the number of enumerators assigned to
-- the district. That worked for exclusivity but had two faults this fixes:
--
--   1. It could not express a cap. Your share was 1/n of the district, whatever
--      that happened to be — 990 rows in Sindhudurg, tens of thousands in Pune.
--   2. Every slice silently re-cut whenever an enumerator joined or left a
--      district, because n changed. Devices kept working a share the server no
--      longer agreed with until they resynced.
--
-- A stored claim is stable across reassignment, survives a restart, and is a plain
-- indexed column rather than an expression no index can serve — which also removes
-- the raw-SQL modulo filter the feeds had to use because Prisma cannot express it.
--
-- SAFETY
-- Both columns are nullable with no default, so this is a catalogue-only change in
-- Postgres 11+ — no table rewrite and no long lock on the 295K-row table. Every
-- existing row starts unassigned, which is the correct initial state: the pool is
-- everything, and each device claims its 5000 on next sync.
--
-- The foreign key is added NOT VALID and validated separately. Adding it validated
-- would scan the whole table while holding a lock; NOT VALID takes the constraint
-- immediately for new writes, and VALIDATE then scans without blocking them. The
-- scan is trivial here anyway because every value is NULL, but the pattern is the
-- one to keep if this is ever re-run against a populated column.
--
-- ON DELETE SET NULL is deliberate: removing an enumerator must return their
-- unfinished claims to the pool rather than block the delete or orphan the rows.
-- ============================================================================

ALTER TABLE "stakeholders" ADD COLUMN IF NOT EXISTS "assigned_to_id" TEXT;
ALTER TABLE "stakeholders" ADD COLUMN IF NOT EXISTS "assigned_at" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stakeholders_assigned_to_id_fkey'
  ) THEN
    ALTER TABLE "stakeholders"
      ADD CONSTRAINT "stakeholders_assigned_to_id_fkey"
      FOREIGN KEY ("assigned_to_id") REFERENCES "enumerators"("id")
      ON DELETE SET NULL ON UPDATE CASCADE
      NOT VALID;

    ALTER TABLE "stakeholders" VALIDATE CONSTRAINT "stakeholders_assigned_to_id_fkey";
  END IF;
END $$;

-- Serves the sync feeds: "everything assigned to me".
CREATE INDEX IF NOT EXISTS "stakeholders_assigned_to_id_idx"
  ON "stakeholders" ("assigned_to_id");

-- Serves the claim query, which hunts unassigned OPEN rows inside a district.
-- Column order matters: district narrows first, then the NULL check.
CREATE INDEX IF NOT EXISTS "stakeholders_district_assigned_to_id_status_idx"
  ON "stakeholders" ("district", "assigned_to_id", "status");
