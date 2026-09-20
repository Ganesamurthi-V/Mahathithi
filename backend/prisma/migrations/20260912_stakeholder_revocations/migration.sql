-- ============================================================================
-- REVOCATIONS: make a released claim visible to the device that held it
-- ============================================================================
--
-- The delta feed locates a device's work with `assigned_to_id = me`. The instant a
-- claim is released that row stops matching, so the feed can never mention it
-- again: the device keeps its local copy and keeps offering it as work. When
-- another enumerator then claims it, two people survey the same business, which is
-- the one thing the assignment model exists to prevent.
--
-- A release therefore records a row here, and the feed returns it as a removal
-- instruction alongside the ones it already sends for completed work. The client
-- already treats that list safely - it purges only stakeholders with nothing left
-- to upload - so a revocation cannot destroy unsynced field work.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "stakeholder_revocations" (
  "id"             TEXT NOT NULL,
  "stakeholder_id" TEXT NOT NULL,
  "enumerator_id"  TEXT NOT NULL,
  "reason"         TEXT,
  "revoked_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stakeholder_revocations_pkey" PRIMARY KEY ("id")
);

-- Cascade on the enumerator: if the account is deleted there is no device left to
-- inform. Deliberately NO foreign key to stakeholders - a revocation must outlive
-- the row it refers to, since the device still has to be told to drop it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stakeholder_revocations_enumerator_id_fkey'
  ) THEN
    ALTER TABLE "stakeholder_revocations"
      ADD CONSTRAINT "stakeholder_revocations_enumerator_id_fkey"
      FOREIGN KEY ("enumerator_id") REFERENCES "enumerators"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- The feed's access path: one enumerator's revocations after a cursor.
CREATE INDEX IF NOT EXISTS "stakeholder_revocations_enumerator_id_revoked_at_idx"
  ON "stakeholder_revocations" ("enumerator_id", "revoked_at");

-- Lets a sweeper drop rows every device has long since seen.
CREATE INDEX IF NOT EXISTS "stakeholder_revocations_revoked_at_idx"
  ON "stakeholder_revocations" ("revoked_at");
