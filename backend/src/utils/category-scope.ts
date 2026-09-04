import { prisma } from '../config/database';
import { logger } from './logger';

/**
 * Canonical stakeholder categories, for building index-friendly query filters.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The category search filter was written as:
 *
 *     category: { contains: value, mode: 'insensitive' }
 *
 * which Prisma compiles to `category ILIKE '%value%'`. A leading wildcard cannot
 * use a b-tree index, so the planner instead walked idx_sh_list_global in priority
 * order applying the filter row by row. Measured on the live database for
 * `category=Hotels`, returning 20 rows:
 *
 *     ILIKE '%Hotels%'                155,073 buffers (~1.2 GB), 154,276 rows discarded
 *     category IN ('Hotels & Resorts')     23 buffers
 *
 * That is the single most expensive filter in the application, ~6,700x the I/O of
 * the equivalent exact match.
 *
 * Confirmed the old b-tree on `category` was never the answer: restoring
 * stakeholders_category_idx inside a transaction produced a byte-identical plan and
 * the same 155,073 buffers, and a GIN trigram on the column did not help either.
 * The operator was the problem, not the absence of an index.
 *
 * ── Why not simply switch `contains` to `equals` ───────────────────────────
 * That would change results. Today `category=Hotels` matches 'Hotels & Resorts',
 * and callers rely on partial values. So rather than narrowing the API, the input
 * is resolved against the real set of category values first, and then filtered with
 * exact equality — which is index-friendly. Same result set, a fraction of the I/O.
 *
 * This mirrors utils/district-scope.ts, which solved the same class of problem
 * (`mode: 'insensitive'` defeating an index) the same way.
 */

/** The distinct, non-empty values of stakeholders.category. */
let categories: string[] | null = null;
let loadedAt = 0;

// Categories come from the bulk import and change only when new data is loaded, so
// an hour-long cache costs at most one tiny query per hour per process.
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Read the distinct category values.
 *
 * Uses a "loose index scan" rather than SELECT DISTINCT. A plain DISTINCT has to
 * traverse every index entry for all 295K rows to find the ~12 distinct values;
 * the recursive form descends the index once per distinct value instead. Measured:
 *
 *     SELECT DISTINCT category   469 ms, 2,773 buffers
 *     loose index scan             2 ms,    38 buffers
 *
 * Requires an index whose leading column is `category` — idx_sh_category_list.
 */
async function loadCategories(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ cat: string | null }[]>`
    WITH RECURSIVE t AS (
      SELECT min(category) AS cat FROM stakeholders
      UNION ALL
      SELECT (SELECT min(category) FROM stakeholders WHERE category > t.cat)
      FROM t WHERE t.cat IS NOT NULL
    )
    SELECT cat FROM t WHERE cat IS NOT NULL AND cat <> ''
  `;
  return rows.map(r => r.cat!).filter(Boolean);
}

async function getCategories(): Promise<string[]> {
  const fresh = categories && Date.now() - loadedAt < CACHE_TTL_MS;
  if (fresh) return categories!;

  try {
    const list = await loadCategories();
    categories = list;
    loadedAt = Date.now();
    return list;
  } catch (err) {
    // Never let this break request handling. Serve a stale list if we have one;
    // otherwise return empty and let the caller fall back.
    logger.error('[category-scope] failed to load canonical categories:', err);
    return categories ?? [];
  }
}

/**
 * Build an index-friendly category filter from caller input.
 *
 * Resolution keeps the OLD substring semantics: every canonical value containing
 * the input (case-insensitively) is matched, so 'Hotels' still resolves to
 * 'Hotels & Resorts' and 'tour' still resolves to both tour-operator categories.
 *
 * Returns:
 *  - `{ category: { in: [...] } }` with no `mode`, so Postgres compares the raw
 *    column and can use idx_sh_category_list.
 *  - `null` when the canonical list could not be loaded, so the caller can fall
 *    back to the original ILIKE filter rather than silently returning nothing.
 *  - `{ category: { in: [] } }` when the input matches no known category, which
 *    correctly yields zero rows — the same outcome the ILIKE filter gave.
 */
export async function categoryFilter(
  value: string
): Promise<{ category: { in: string[] } } | null> {
  const needle = String(value || '').trim().toLowerCase();
  if (!needle) return { category: { in: [] } };

  const all = await getCategories();
  // Empty list means the lookup failed (a populated table always has values), so
  // signal "cannot resolve" rather than "matches nothing".
  if (all.length === 0) return null;

  const matched = all.filter(cat => cat.toLowerCase().includes(needle));
  return { category: { in: matched } };
}

/** Test seam / admin hook: force the next lookup to re-read the table. */
export function invalidateCategoryCache(): void {
  categories = null;
  loadedAt = 0;
}
