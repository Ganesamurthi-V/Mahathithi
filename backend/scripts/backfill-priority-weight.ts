/**
 * Backfill stakeholders.priority_weight: NULL -> 0.
 *
 * WHY
 * The admin list orders by `priority_weight DESC, company_name_standardized ASC`.
 * In Postgres DESC means NULLS FIRST, so the 104,412 unscored rows sorted ahead of
 * every scored one and page 1 was entirely unscored records ("0", "1",
 * "!!! SHREE SWAMI SAMARTH ..."). Real scores run 1..6, so 0 is an unused value
 * and works as an explicit "not scored" sentinel that sorts last under DESC.
 *
 * Chosen over `ORDER BY ... DESC NULLS LAST` because that would need a replacement
 * index; this keeps idx_sh_list_global (priority_weight DESC,
 * company_name_standardized) matching exactly, so the unfiltered page stays at
 * ~9 ms and no application code changes.
 *
 * SAFETY
 *  - Asserts up front that no row already has priority_weight = 0, so the mapping
 *    stays exactly reversible (UPDATE ... SET priority_weight = NULL WHERE = 0).
 *  - Batched, so it never holds one long transaction over 104K rows.
 *  - VACUUM afterwards: 104K updated rows leave that many dead tuples, which would
 *    otherwise degrade the index-only scans this table depends on.
 *
 * Usage:  npx tsx scripts/backfill-priority-weight.ts [--revert]
 */
import dotenv from 'dotenv';
dotenv.config();
import { Client } from 'pg';

const REVERT = process.argv.includes('--revert');
const BATCH = 10_000;

// Session mode: this does DDL-adjacent maintenance (VACUUM) and long batches.
const url = (process.env.DATABASE_URL || '').replace(':6543/', ':5432/').split('?')[0];
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function distribution(label: string) {
  const { rows } = await c.query(
    `SELECT priority_weight AS pw, COUNT(*)::int AS n
     FROM stakeholders GROUP BY priority_weight ORDER BY priority_weight NULLS FIRST`
  );
  console.log(`\n=== ${label} ===`);
  for (const r of rows) console.log(`  pw=${String(r.pw ?? 'NULL').padEnd(6)} ${r.n.toLocaleString()}`);
}

async function pageOne(label: string) {
  const { rows } = await c.query(
    `SELECT company_name_standardized AS name, priority_weight AS pw, district
     FROM stakeholders
     ORDER BY priority_weight DESC, company_name_standardized ASC
     LIMIT 6`
  );
  console.log(`\n=== ${label} ===`);
  for (const r of rows) {
    console.log(`  pw=${String(r.pw ?? 'NULL').padEnd(6)} ${String(r.name).slice(0, 44).padEnd(46)} ${r.district ?? ''}`);
  }
}

async function searchTimings(label: string) {
  console.log(`\n=== ${label} ===`);
  for (const term of ['hotel', 'resort', 'homestay', 'lodge', 'travels']) {
    const { rows } = await c.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT s.id FROM stakeholders s
       WHERE (s.company_name_standardized ILIKE '%${term}%' OR s.company_name_original ILIKE '%${term}%')
       ORDER BY s.priority_weight DESC, s.company_name_standardized ASC
       LIMIT 20`
    );
    const t = rows.map((r: any) => r['QUERY PLAN']).join('\n');
    const exec = Number(t.match(/Execution Time: ([\d.]+)/)?.[1] || 0);
    const buffers = [...t.matchAll(/shared hit=(\d+)(?: read=(\d+))?/g)]
      .reduce((m, x) => Math.max(m, Number(x[1]) + Number(x[2] || 0)), 0);
    const scan = t.match(/(Index Scan using \w+|Bitmap Heap Scan|Seq Scan)/)?.[0] || '?';
    console.log(`  ${term.padEnd(10)} exec=${String(exec.toFixed(0)).padStart(5)}ms buffers=${String(buffers).padStart(7)}  ${scan}`);
  }
}

async function main() {
  await c.connect();
  console.log(`connected — mode: ${REVERT ? 'REVERT (0 -> NULL)' : 'BACKFILL (NULL -> 0)'}`);

  await distribution('BEFORE: priority_weight distribution');
  await pageOne('BEFORE: admin page 1');
  if (!REVERT) await searchTimings('BEFORE: filtered search cost');

  if (!REVERT) {
    // Reversibility guard: if a real 0 already existed we could not tell it apart
    // from a backfilled one afterwards.
    const { rows: zero } = await c.query(`SELECT COUNT(*)::int AS n FROM stakeholders WHERE priority_weight = 0`);
    if (zero[0].n > 0) {
      console.error(`\nABORT: ${zero[0].n} row(s) already have priority_weight = 0, so this would not be reversible.`);
      await c.end();
      process.exit(1);
    }
    console.log('\nreversibility check: no existing priority_weight = 0 — safe');
  }

  const from = REVERT ? 'priority_weight = 0' : 'priority_weight IS NULL';
  const to = REVERT ? 'NULL' : '0';

  const { rows: todo } = await c.query(`SELECT COUNT(*)::int AS n FROM stakeholders WHERE ${from}`);
  console.log(`\nrows to update: ${todo[0].n.toLocaleString()}`);

  let done = 0;
  const t0 = Date.now();
  // Batched by primary key so each statement is short and never locks the table
  // for long. ctid would also work but is unstable across updates.
  for (;;) {
    const { rowCount } = await c.query(
      `UPDATE stakeholders SET priority_weight = ${to}
       WHERE id IN (
         SELECT id FROM stakeholders WHERE ${from} LIMIT ${BATCH}
       )`
    );
    if (!rowCount) break;
    done += rowCount;
    console.log(`  updated ${done.toLocaleString()} / ${todo[0].n.toLocaleString()}`);
  }
  console.log(`update finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 104K updated rows means 104K dead tuples; without this the index-only scans
  // this table relies on start hitting the heap again.
  console.log('\nVACUUM (ANALYZE) stakeholders …');
  const t1 = Date.now();
  await c.query('VACUUM (ANALYZE) stakeholders');
  console.log(`done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  const { rows: vis } = await c.query(
    `SELECT round(100.0 * relallvisible / NULLIF(relpages, 0), 1) AS pct
     FROM pg_class WHERE relname = 'stakeholders'`
  );
  console.log(`all-visible after vacuum: ${vis[0].pct}%`);

  await distribution('AFTER: priority_weight distribution');
  await pageOne('AFTER: admin page 1');
  await searchTimings('AFTER: filtered search cost');

  console.log(`\nto undo: npx tsx scripts/backfill-priority-weight.ts --revert`);
  await c.end();
}
main().catch(async (e) => { console.error(String(e.message).slice(0, 400)); try { await c.end(); } catch {} process.exit(1); });
