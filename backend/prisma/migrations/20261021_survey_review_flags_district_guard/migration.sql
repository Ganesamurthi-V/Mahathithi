-- ============================================================================
-- Survey review flags, admin-edit marker, and a guard on districts
-- ============================================================================

-- Survey.admin_edited_at: set when an admin edits a survey. A later upload from the
-- phone must not overwrite the admin's corrections, so the upload path checks this.
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "admin_edited_at" TIMESTAMP(3);

-- Survey.needs_review / review_reason: raised for an admin to look at. Two causes:
-- the survey's GPS is far from the business, or field work arrived after the record
-- was already completed by someone else. Nullable/defaulted, so no table rewrite.
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "needs_review" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "review_reason" TEXT;

-- Only flagged rows are ever read through this index, so keep it partial and tiny.
CREATE INDEX IF NOT EXISTS "surveys_needs_review_idx" ON "surveys" ("needs_review") WHERE "needs_review" = true;

-- ----------------------------------------------------------------------------
-- District guard
-- ----------------------------------------------------------------------------
-- Stakeholders store their district as TEXT, not as a foreign key. Deleting or
-- renaming a district therefore cannot touch them, but it DOES drop the enumerator
-- links (ON DELETE CASCADE), so every record claimed in that district would stay
-- assigned to someone who can no longer reach it, and nobody else could claim it.
--
-- No admin screen deletes or renames districts today (they are created by scripts),
-- so this is enforced here, where it applies to scripts and a database console too.
-- Release the claims first (PUT /admin/enumerators/:id/districts does that), then
-- the district can go.
CREATE OR REPLACE FUNCTION fn_guard_district_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_claimed int;
BEGIN
  SELECT COUNT(*) INTO v_claimed
  FROM stakeholders
  WHERE district = OLD.name
    AND status = 'OPEN'
    AND assigned_to_id IS NOT NULL;

  IF v_claimed > 0 THEN
    RAISE EXCEPTION 'Cannot % district "%": % open record(s) in it are claimed by enumerators. Release those claims first.',
      CASE TG_OP WHEN 'DELETE' THEN 'delete' ELSE 'rename' END,
      OLD.name,
      v_claimed
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_district_delete ON districts;
CREATE TRIGGER trg_guard_district_delete
  BEFORE DELETE ON districts
  FOR EACH ROW EXECUTE FUNCTION fn_guard_district_change();

DROP TRIGGER IF EXISTS trg_guard_district_rename ON districts;
CREATE TRIGGER trg_guard_district_rename
  BEFORE UPDATE OF name ON districts
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION fn_guard_district_change();
