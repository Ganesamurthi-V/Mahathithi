/**
 * Drop provably-useless indexes on `stakeholders`.
 *
 * WHY THIS IS SAFE TO JUDGE NOW
 * pg_stat_database.stats_reset is NULL and uptime is 45 days, so idx_scan = 0
 * means genuinely unused across 45 days of production traffic — not a counter that
 * was reset. The earlier 20260830 migration deliberately deferred this decision
 * for exactly that reason ("counters that reset on restart"); that caveat no
 * longer applies.
 *
 * Every index below is justified by something stronger than a scan count:
 *
 *  A. The indexed column is entirely NULL, so the index has no entries that can
 *     ever match a predicate:
 *       gst_number       0 distinct  (100% NULL)
 *       company_status   0 distinct  (100% NULL)
 *       taluka           0 distinct  (100% NULL)
 *
 *  B. The leading column has ONE distinct value ('Maharashtra'), so it offers no
 *     selectivity and any composite leading with it is strictly worse than the
 *     equivalent index on the second column:
 *       state            1 distinct
 *
 *  C. No query in the application references the column at all. StakeholderService
 *     .search() accepts: name, org, state, district, pinCode, category, nicCode,
 *     gst, taluka, city, status, digipin. `full_address_raw` is not among them, so
 *     a 59 MB trigram index on it backs nothing. It is the single largest index on
 *     the table.
 *
 *  D. The filter uses ILIKE '%x%', which a btree cannot serve — those paths are
 *     served by the GIN trigram indexes, which are kept.
 *
 * DELIBERATELY KEPT even at 0 scans, because they back a filter the admin UI
 * exposes and CAN use:
 *   stakeholders_pin_code_idx    — pinCode uses startsWith, which a btree serves
 *   idx_stakeholders_city_trgm   — city uses ILIKE, which the trigram serves
 *
 * Reversible: every statement below is a DROP of a non-unique, non-constraint
 * index. The exact CREATE statement to restore each one is recorded alongside.
 *
 * Usage:  npx tsx scripts/drop-unused-indexes.ts [--dry-run]
 */
import dotenv from 'dotenv';
dotenv.config();
import { Client } from 'pg';

const DRY = process.argv.includes('--dry-run');
const url = (process.env.DATABASE_URL || '').replace(':6543/', ':5432/').split('?')[0];
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

/** name -> why it goes, plus the statement that would put it back. */
const DROPS: { name: string; reason: string; restore: string }[] = [
  // --- A: indexed column is 100% NULL -----------------------------------------
  { name: 'stakeholders_gst_number_idx', reason: 'gst_number is 100% NULL (0 distinct)',
    restore: 'CREATE INDEX stakeholders_gst_number_idx ON stakeholders (gst_number)' },
  { name: 'idx_sh_gst_trgm', reason: 'gst_number is 100% NULL (0 distinct)',
    restore: 'CREATE INDEX idx_sh_gst_trgm ON stakeholders USING gin (gst_number gin_trgm_ops)' },
  { name: 'stakeholders_company_status_idx', reason: 'company_status is 100% NULL (0 distinct)',
    restore: 'CREATE INDEX stakeholders_company_status_idx ON stakeholders (company_status)' },
  { name: 'stakeholders_taluka_idx', reason: 'taluka is 100% NULL (0 distinct); its 1 scan matched nothing',
    restore: 'CREATE INDEX stakeholders_taluka_idx ON stakeholders (taluka)' },

  // --- B: leading column has a single distinct value --------------------------
  { name: 'stakeholders_state_idx', reason: "state has 1 distinct value — no selectivity",
    restore: 'CREATE INDEX stakeholders_state_idx ON stakeholders (state)' },
  { name: 'stakeholders_state_district_idx', reason: 'leads with state (1 value); stakeholders_district_idx covers this better',
    restore: 'CREATE INDEX stakeholders_state_district_idx ON stakeholders (state, district)' },
  { name: 'stakeholders_state_category_idx', reason: 'leads with state (1 value); offers nothing over a category index',
    restore: 'CREATE INDEX stakeholders_state_category_idx ON stakeholders (state, category)' },

  // --- C: no query references the column --------------------------------------
  { name: 'idx_stakeholders_address_trgm', reason: 'no search filter references full_address_raw; 59 MB backing nothing',
    restore: 'CREATE INDEX idx_stakeholders_address_trgm ON stakeholders USING gin (full_address_raw gin_trgm_ops)' },

  // --- D: btree cannot serve the ILIKE these columns are filtered with --------
  { name: 'stakeholders_company_name_standardized_district_idx', reason: 'name search is ILIKE %x%, served by the GIN trigram index; 0 scans',
    restore: 'CREATE INDEX stakeholders_company_name_standardized_district_idx ON stakeholders (company_name_standardized, district)' },
  { name: 'stakeholders_category_idx', reason: 'category filter is ILIKE %x%, which btree cannot serve; 0 scans',
    restore: 'CREATE INDEX stakeholders_category_idx ON stakeholders (category)' },
  { name: 'stakeholders_district_category_idx', reason: 'category half is ILIKE; district alone is already indexed; 0 scans',
    restore: 'CREATE INDEX stakeholders_district_category_idx ON stakeholders (district, category)' },
  { name: 'stakeholders_city_idx', reason: 'city filter is ILIKE %x%, served by idx_stakeholders_city_trgm; 0 scans',
    restore: 'CREATE INDEX stakeholders_city_idx ON stakeholders (city)' },
  { name: 'stakeholders_district_pin_code_idx', reason: 'redundant with stakeholders_pin_code_idx + stakeholders_district_idx; 0 scans',
    restore: 'CREATE INDEX stakeholders_district_pin_code_idx ON stakeholders (district, pin_code)' },
];

async function totals() {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n, pg_size_pretty(pg_indexes_size('stakeholders')) AS pretty,
            pg_indexes_size('stakeholders') AS bytes
     FROM pg_indexes WHERE tablename = 'stakeholders'`
  );
  return rows[0];
}

async function planningTime(label: string) {
  // Planning cost scales with the number of candidate indexes the planner must
  // consider, so it is the metric this change should move.
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const { rows } = await c.query(
      `EXPLAIN (ANALYZE)
       SELECT s.id FROM stakeholders s
       WHERE (s.company_name_standardized ILIKE '%hotel%' OR s.company_name_original ILIKE '%hotel%')
       ORDER BY s.priority_weight DESC, s.company_name_standardized ASC LIMIT 20`
    );
    const t = rows.map((r: any) => r['QUERY PLAN']).join('\n');
    times.push(Number(t.match(/Planning Time: ([\d.]+)/)?.[1] || 0));
  }
  console.log(`  ${label}: planning ${Math.min(...times).toFixed(2)} ms (best of 3)`);
  return Math.min(...times);
}

async function main() {
  await c.connect();

  const before = await totals();
  console.log(`BEFORE: ${before.n} indexes, ${before.pretty}`);
  const planBefore = await planningTime('BEFORE');

  // Confirm each target still exists and is safe to drop (never unique/constraint).
  console.log(`\n=== ${DRY ? 'WOULD DROP' : 'DROPPING'} ${DROPS.length} indexes ===`);
  let freed = 0;
  for (const d of DROPS) {
    const { rows } = await c.query(
      `SELECT pg_relation_size(i.indexrelid) AS bytes, x.indisunique, x.indisprimary,
              EXISTS (SELECT 1 FROM pg_constraint WHERE conindid = i.indexrelid) AS backs_constraint
       FROM pg_stat_user_indexes i JOIN pg_index x ON x.indexrelid = i.indexrelid
       WHERE i.indexrelname = $1`,
      [d.name]
    );
    if (rows.length === 0) { console.log(`  SKIP  ${d.name} (not present)`); continue; }
    const r = rows[0];
    if (r.indisunique || r.indisprimary || r.backs_constraint) {
      console.log(`  SKIP  ${d.name} — unique/primary/constraint-backing, refusing to drop`);
      continue;
    }
    const mb = (Number(r.bytes) / 1024 / 1024).toFixed(1);
    if (DRY) {
      console.log(`  would drop ${d.name.padEnd(52)} ${mb.padStart(6)} MB  — ${d.reason}`);
    } else {
      // CONCURRENTLY: takes no lock that blocks reads or writes. Cannot run inside
      // a transaction, which is why this is a script and not a .sql migration.
      await c.query(`DROP INDEX CONCURRENTLY IF EXISTS ${d.name}`);
      console.log(`  dropped ${d.name.padEnd(54)} ${mb.padStart(6)} MB`);
    }
    freed += Number(r.bytes);
  }
  console.log(`\n${DRY ? 'would free' : 'freed'}: ${(freed / 1024 / 1024).toFixed(0)} MB`);

  if (DRY) { await c.end(); return; }

  await c.query('ANALYZE stakeholders');
  const after = await totals();
  console.log(`\nAFTER: ${after.n} indexes, ${after.pretty}`);
  const planAfter = await planningTime('AFTER ');
  console.log(`\nplanning time: ${planBefore.toFixed(2)} ms -> ${planAfter.toFixed(2)} ms`);

  console.log('\n=== restore statements, if any query regresses ===');
  DROPS.forEach((d) => console.log(`  ${d.restore};`));

  await c.end();
}
main().catch(async (e) => { console.error(String(e.message).slice(0, 400)); try { await c.end(); } catch {} process.exit(1); });
