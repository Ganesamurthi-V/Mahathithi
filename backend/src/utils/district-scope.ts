import { prisma } from '../config/database';
import { logger } from './logger';

/**
 * Canonical district names, for building index-friendly query filters.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Every stakeholder query is scoped by district. Those filters were written as:
 *
 *     district: { in: districts, mode: 'insensitive' }
 *
 * Prisma compiles `mode: 'insensitive'` on an `in` filter to
 * `LOWER(district) IN (LOWER($1), LOWER($2))`. That expression cannot use ANY of
 * the b-tree indexes on `district`, because those index the raw column and not
 * `LOWER(district)`. Postgres therefore fell back to a Parallel Seq Scan over all
 * 295K stakeholder rows on every single request. Measured on the live database:
 *
 *     with LOWER()    -> Parallel Seq Scan, 422 ms warm / 3423 ms cold
 *     without LOWER() -> Index Scan,         90 ms
 *
 * The values were verified to already be consistently cased: all 36 distinct
 * `districts.name` values match `stakeholders.district` exactly, with no casing
 * differences and no stray whitespace. So the insensitive matching was buying
 * nothing and costing a full table scan.
 *
 * ── Why not just delete `mode: 'insensitive'` ──────────────────────────────
 * Exact matching is only correct while the two tables stay in agreement. If a
 * future import wrote 'PUNE' or ' Pune', an exact filter would silently return
 * zero rows — an enumerator would open the app to an empty work queue with no
 * error anywhere. Note this direction of failure is fail-safe for security (a
 * scope filter matching nothing can never widen access), but it is a bad
 * functional bug and a confusing one to diagnose.
 *
 * So instead of trusting the caller's casing, we map whatever we are given onto
 * the canonical spelling stored in the `districts` table, then filter exactly.
 * That keeps the index usable AND tolerates casing drift in the input.
 */

/** lowercase name -> canonical name as stored in districts.name */
let canonicalByLower: Map<string, string> | null = null;
let loadedAt = 0;

// District names are effectively static (36 rows for Maharashtra, changed only
// by an admin action). An hour-long cache means at most one tiny query per hour
// per process, and it self-heals if a district is ever renamed or added.
const CACHE_TTL_MS = 60 * 60 * 1000;

async function getCanonicalMap(): Promise<Map<string, string>> {
  const fresh = canonicalByLower && Date.now() - loadedAt < CACHE_TTL_MS;
  if (fresh) return canonicalByLower!;

  try {
    const rows = await prisma.district.findMany({ select: { name: true } });
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.name) map.set(r.name.trim().toLowerCase(), r.name);
    }
    canonicalByLower = map;
    loadedAt = Date.now();
    return map;
  } catch (err) {
    // Never let a lookup failure break request handling. Reuse a stale map if we
    // have one; otherwise return empty and let the caller pass values through.
    logger.error('[district-scope] failed to load canonical district names:', err);
    return canonicalByLower ?? new Map();
  }
}

/**
 * Map caller-supplied district names onto their canonical spelling.
 *
 * Unrecognised names are passed through trimmed rather than dropped: they simply
 * match no rows, which is the same outcome as before and keeps the scope filter
 * fail-safe.
 */
export async function canonicalizeDistricts(names: string[]): Promise<string[]> {
  if (!names || names.length === 0) return [];
  const map = await getCanonicalMap();

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    if (!raw) continue;
    const trimmed = String(raw).trim();
    const canonical = map.get(trimmed.toLowerCase()) ?? trimmed;
    if (!seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  }
  return out;
}

/**
 * Build an index-friendly district scope filter.
 *
 * Returns `{ district: { in: [...] } }` with NO `mode`, so Postgres compares the
 * raw column and can use the b-tree indexes on `district`.
 */
export async function districtScopeFilter(
  districts: string[]
): Promise<{ district: { in: string[] } }> {
  return { district: { in: await canonicalizeDistricts(districts) } };
}

/** Test seam / admin hook: force the next lookup to re-read the table. */
export function invalidateDistrictCache(): void {
  canonicalByLower = null;
  loadedAt = 0;
}
