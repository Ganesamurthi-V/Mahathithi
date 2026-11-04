/**
 * Helpers for matching and suggesting business names.
 *
 * "The same name" is defined ONCE, in the database function sh_name_key(std, orig)
 * (prisma/migrations/20261105_sh_name_key_function): lower-cased, with spaces and punctuation
 * removed. Queries call that function so they match the index built on it. Nothing here
 * reimplements it in JavaScript, because a second definition is how a check and an index drift
 * apart.
 */

/** Longest query the suggestions endpoint accepts. */
export const SUGGEST_MAX_QUERY_LENGTH = 100;

/**
 * Shortest query that may use the "contains" search. Trigram indexes cannot serve a pattern of
 * fewer than 3 characters, and without one Postgres reads the whole table (measured at about
 * half a second on a copy, many seconds on the real one). Two characters get the prefix search
 * only, which is a cheap index range scan.
 */
export const SUGGEST_MIN_CONTAINS_LENGTH = 3;

/** Shortest query that returns anything at all. */
export const SUGGEST_MIN_QUERY_LENGTH = 2;

export const SUGGEST_DEFAULT_LIMIT = 8;
export const SUGGEST_MAX_LIMIT = 10;

/**
 * Escape the characters LIKE treats as wildcards, so a name typed as "50%_off" is matched
 * literally. Pair with ESCAPE '\' in the SQL; the pattern itself is built here, in code.
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => '\\' + c);
}

export interface SuggestQuery {
  /** The text the user typed, trimmed and capped. */
  q: string;
  limit: number;
  /** "starts with" pattern, lower-cased, for the prefix index. */
  prefixPattern: string;
  /** "contains" pattern, or null when the query is too short for the trigram index. */
  containsPattern: string | null;
}

/**
 * Turn raw query-string input into the values the suggestions SQL needs, or null when there is
 * nothing worth searching for.
 */
export function buildSuggestQuery(rawQ: unknown, rawLimit: unknown): SuggestQuery | null {
  if (typeof rawQ !== 'string') return null;
  const q = rawQ.trim().replace(/\s+/g, ' ').slice(0, SUGGEST_MAX_QUERY_LENGTH);
  if (q.length < SUGGEST_MIN_QUERY_LENGTH) return null;

  const parsed = Number.parseInt(String(rawLimit ?? ''), 10);
  const limit = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), SUGGEST_MAX_LIMIT)
    : SUGGEST_DEFAULT_LIMIT;

  const escaped = escapeLike(q);
  return {
    q,
    limit,
    prefixPattern: escaped.toLowerCase() + '%',
    containsPattern: q.length >= SUGGEST_MIN_CONTAINS_LENGTH ? '%' + escaped + '%' : null,
  };
}
