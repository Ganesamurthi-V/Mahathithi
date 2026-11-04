-- ============================================================================
-- sh_name_key(): the ONE definition of "the same business name"
-- ============================================================================
--
-- Creating a stakeholder is refused when another stakeholder in the same district has the
-- same name once case, spaces and punctuation are ignored:
--
--     "AL- MIZAN"  ->  almizan      "Al Mizan"  ->  almizan      (same)
--     "ABC (P) LTD." -> abcpltd     "abc p ltd" -> abcpltd       (same)
--
-- Only spaces and punctuation are stripped. Letters and combining marks of every script
-- are kept, so two different Marathi/Devanagari names do not collapse into one
-- (a [[:alnum:]] class would strip the vowel signs and make them collide).
--
-- It lives in the database, not in application code, so the duplicate check and the indexes
-- below are built from the same expression and cannot drift apart. The planner only uses an
-- expression index when the query's expression is identical, which is the point.
--
-- The standardized name is used, falling back to the original when it is blank, which
-- matches the name the lists display.
--
-- IMMUTABLE is accurate (same input, same output) and required to index the expression.
-- Verified: it creates and indexes on the live data.
--
-- Safe to run while users work: it only adds a function. APPLY THIS BEFORE deploying the
-- backend; without it, creating a stakeholder fails.
-- To undo:  DROP FUNCTION IF EXISTS sh_name_key(text, text);   (drop the indexes that use it first)
-- ============================================================================

CREATE OR REPLACE FUNCTION sh_name_key(std text, orig text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(
    lower(coalesce(nullif(btrim(std), ''), nullif(btrim(orig), ''), '')),
    '[[:space:][:punct:]]+',
    '',
    'g'
  )
$$;
