-- ============================================================================
-- District admin role
-- ============================================================================
--
-- A district admin is an admin-panel user restricted to their assigned districts. They
-- can view, edit and create surveys and add stakeholders there, but cannot delete
-- enumerators or stakeholders and cannot see global pages. It is a flag next to is_admin,
-- never a replacement for it: a district admin has is_admin = false.
--
-- Additive and instant: a constant default means no table rewrite, and every existing
-- account stays false, so nothing changes for current users.
--
-- APPLY THIS BEFORE DEPLOYING THE BACKEND. Prisma selects every column of enumerators on
-- every login and request, so code that knows the column fails if it does not exist yet.
-- To undo:  ALTER TABLE "enumerators" DROP COLUMN IF EXISTS "is_district_admin";
-- ============================================================================

ALTER TABLE "enumerators" ADD COLUMN IF NOT EXISTS "is_district_admin" BOOLEAN NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- Keep district admins out of the work queue, in the database as well
-- ----------------------------------------------------------------------------
-- The database rebalances a district on its own whenever its roster changes
-- (triggers on enumerator_districts and enumerators.is_active). Those functions treat
-- every active account that is not a full admin as a field worker, so assigning
-- districts to a district admin would have handed them a work queue they will never
-- collect, shrinking everyone else's share. They are replaced below with the SAME
-- bodies as the live database, changed only to also exclude is_district_admin.
-- Requires the column added above, so this stays in the same migration.
-- To undo: re-run 20260914_fair_share_rebalance_trigger/migration.sql.
-- ----------------------------------------------------------------------------

-- fn_rebalance_district
CREATE OR REPLACE FUNCTION fn_rebalance_district(p_district text, p_quota integer DEFAULT 5000)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_total int;
  v_n     int;
  v_share int;
  v_want  int;
  r       RECORD;
BEGIN
  IF p_district IS NULL OR btrim(p_district) = '' THEN RETURN; END IF;

  -- The same advisory lock the API's claim path takes, so a device syncing at this
  -- moment cannot interleave with the rebalance and act on stale counts. Re-taking
  -- it inside the API's own transaction is harmless: advisory locks are re-entrant
  -- for the same session.
  PERFORM pg_advisory_xact_lock(2::int, hashtext(p_district));

  -- Only active, non-admin enumerators are sharers. An inactive account would
  -- reserve a share nobody collects; an admin sees whole districts and holds no
  -- queue, so counting either would shrink everyone else's share for nothing.
  SELECT COUNT(*) INTO v_n
  FROM enumerator_districts ed
  JOIN districts d   ON d.id = ed.district_id
  JOIN enumerators e ON e.id = ed.enumerator_id
  WHERE d.name = p_district AND e.is_active AND NOT e.is_admin AND NOT e.is_district_admin;

  IF v_n = 0 THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_total
  FROM stakeholders WHERE district = p_district AND status = 'OPEN';

  IF v_total = 0 THEN RETURN; END IF;

  v_share := LEAST(p_quota, CEIL(v_total::numeric / v_n)::int);

  -- ---- PASS 1: take back everything held above the new share ----------------
  -- Only rows with no survey attached may move. A stakeholder somebody has begun
  -- surveying stays with them regardless of share: moving it would strand
  -- half-finished work and risk a second enumerator repeating the visit.
  -- Lowest priority_weight goes first, the mirror of how rows are handed out, so a
  -- holder loses the tail of their batch and keeps their most valuable work.
  WITH held_counts AS (
    SELECT assigned_to_id, COUNT(*)::int AS held
    FROM stakeholders
    WHERE district = p_district AND status = 'OPEN' AND assigned_to_id IS NOT NULL
    GROUP BY assigned_to_id
  ),
  releasable AS (
    SELECT st.id, st.assigned_to_id,
           ROW_NUMBER() OVER (
             PARTITION BY st.assigned_to_id
             ORDER BY st.priority_weight ASC NULLS FIRST, st.primary_key_id DESC
           ) AS rn
    FROM stakeholders st
    WHERE st.district = p_district
      AND st.status = 'OPEN'
      AND st.assigned_to_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM surveys sv WHERE sv.stakeholder_id = st.id)
  ),
  excess AS (
    SELECT r2.id, r2.assigned_to_id
    FROM releasable r2
    JOIN held_counts h ON h.assigned_to_id = r2.assigned_to_id
    WHERE h.held > v_share AND r2.rn <= h.held - v_share
  ),
  upd AS (
    UPDATE stakeholders st
    SET assigned_to_id = NULL, assigned_at = NULL, updated_at = NOW()
    FROM excess
    WHERE st.id = excess.id
    RETURNING st.id, excess.assigned_to_id AS former
  )
  -- A released claim is invisible to the device that held it: the delta feed finds
  -- work by assigned_to_id = me, so the row silently drops out of the feed and the
  -- phone goes on offering it. This is what tells it to let go.
  INSERT INTO stakeholder_revocations (id, stakeholder_id, enumerator_id, reason, revoked_at)
  SELECT gen_random_uuid()::text, id, former, 'district rebalanced (roster changed)', NOW()
  FROM upd;

  -- ---- PASS 2: fill everyone up to the share, emptiest first ----------------
  -- Take back before giving out: reversed, the emptiest enumerator would draw from
  -- a pool that has not been refilled yet and come away with nothing.
  --
  -- held_total is measured separately from held_here because the 5000 ceiling is
  -- global. Without it, somebody covering three districts would be topped up to a
  -- full share in each and end up with 15000 records on one phone.
  FOR r IN
    SELECT e.id AS eid,
           (SELECT COUNT(*) FROM stakeholders s
             WHERE s.district = p_district AND s.status = 'OPEN' AND s.assigned_to_id = e.id)::int AS held_here,
           (SELECT COUNT(*) FROM stakeholders s
             WHERE s.status = 'OPEN' AND s.assigned_to_id = e.id)::int AS held_total
    FROM enumerator_districts ed
    JOIN districts d   ON d.id = ed.district_id
    JOIN enumerators e ON e.id = ed.enumerator_id
    WHERE d.name = p_district AND e.is_active AND NOT e.is_admin AND NOT e.is_district_admin
    ORDER BY held_here ASC, e.id ASC
  LOOP
    v_want := LEAST(v_share - r.held_here, p_quota - r.held_total);
    IF v_want > 0 THEN
      UPDATE stakeholders st
      SET assigned_to_id = r.eid, assigned_at = NOW(), updated_at = NOW()
      FROM (
        SELECT id FROM stakeholders
        WHERE assigned_to_id IS NULL AND status = 'OPEN' AND district = p_district
        ORDER BY priority_weight DESC NULLS LAST, primary_key_id ASC
        LIMIT v_want
        FOR UPDATE SKIP LOCKED
      ) p
      WHERE st.id = p.id;
    END IF;
  END LOOP;
END $function$;

-- trg_enumerator_active_rebalance
CREATE OR REPLACE FUNCTION trg_enumerator_active_rebalance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_name text;
BEGIN
  -- AFTER UPDATE OF fires whenever the column is in the SET list, changed or not.
  IF NEW.is_active IS NOT DISTINCT FROM OLD.is_active OR NEW.is_admin OR NEW.is_district_admin THEN
    RETURN NULL;
  END IF;

  -- A deactivated account cannot log in, so anything it still holds is work nobody
  -- can do. The claw-back alone would not free it: that only trims holders ABOVE
  -- the share, and a deactivated holder may be sitting exactly on it.
  IF NEW.is_active = false THEN
    WITH rel AS (
      UPDATE stakeholders st
      SET assigned_to_id = NULL, assigned_at = NULL, updated_at = NOW()
      WHERE st.assigned_to_id = NEW.id
        AND st.status = 'OPEN'
        AND NOT EXISTS (SELECT 1 FROM surveys sv WHERE sv.stakeholder_id = st.id)
      RETURNING st.id
    )
    INSERT INTO stakeholder_revocations (id, stakeholder_id, enumerator_id, reason, revoked_at)
    SELECT gen_random_uuid()::text, id, NEW.id, 'enumerator deactivated', NOW() FROM rel;
  END IF;

  FOR v_name IN
    SELECT d.name FROM enumerator_districts ed
    JOIN districts d ON d.id = ed.district_id
    WHERE ed.enumerator_id = NEW.id
    ORDER BY d.name -- fixed order, so two concurrent rebalances cannot deadlock
  LOOP
    PERFORM fn_rebalance_district(v_name);
  END LOOP;

  RETURN NULL;
END $function$;

-- trg_enumerator_districts_rebalance
CREATE OR REPLACE FUNCTION trg_enumerator_districts_rebalance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_name text;
BEGIN
  SELECT name INTO v_name FROM districts
   WHERE id = COALESCE(NEW.district_id, OLD.district_id);

  IF v_name IS NOT NULL THEN
    PERFORM fn_rebalance_district(v_name);
  END IF;

  RETURN NULL; -- AFTER trigger: return value is ignored
END $function$;
