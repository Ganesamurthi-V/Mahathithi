/**
 * Run VACUUM (ANALYZE) on stakeholders.
 *
 * Why this exists instead of psql: VACUUM cannot run inside a transaction block,
 * which rules out the Supabase SQL editor, and Prisma's query engine uses the
 * extended protocol so it cannot issue VACUUM either. node-postgres sends simple
 * queries, so it works. `pg` is already a dependency here.
 *
 * Usage:  npx tsx scripts/vacuum-stakeholders.ts
 *
 * SAFETY: plain VACUUM, not VACUUM FULL. Runs online, takes no exclusive lock,
 * blocks neither reads nor writes.
 */
import dotenv from 'dotenv';
dotenv.config();
import { Client } from 'pg';

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

// VACUUM needs a session-mode connection. Port 6543 is PgBouncer transaction
// pooling, where a maintenance command like this does not belong, so force the
// session-mode port and strip the pgbouncer flags.
const url = raw.replace(':6543/', ':5432/').split('?')[0];
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function visibility(label: string) {
  const { rows } = await client.query(
    `SELECT relpages, relallvisible,
            round(100.0 * relallvisible / NULLIF(relpages, 0), 1) AS pct_all_visible
     FROM pg_class WHERE relname = 'stakeholders'`
  );
  const r = rows[0];
  console.log(`${label}: relpages=${r.relpages} relallvisible=${r.relallvisible} pct_all_visible=${r.pct_all_visible}%`);
}

async function main() {
  await client.connect();
  console.log(`connected (session mode, port 5432)\n`);

  await visibility('BEFORE');

  // VERBOSE output arrives as NOTICE messages.
  client.on('notice', (n) => {
    const msg = (n.message || '').replace(/\s+/g, ' ').trim();
    if (msg) console.log(`   ${msg.slice(0, 200)}`);
  });

  console.log('\nrunning VACUUM (ANALYZE, VERBOSE) stakeholders …');
  const t = Date.now();
  await client.query('VACUUM (ANALYZE, VERBOSE) stakeholders');
  console.log(`done in ${((Date.now() - t) / 1000).toFixed(1)}s\n`);

  await visibility('AFTER ');

  // Keep autovacuum on top of it after future bulk imports.
  await client.query(
    `ALTER TABLE stakeholders SET (
       autovacuum_vacuum_scale_factor = 0.05,
       autovacuum_analyze_scale_factor = 0.02
     )`
  );
  console.log('\nautovacuum thresholds tightened (vacuum at ~5% churn, analyze at ~2%)');

  await client.end();
}

main().catch(async (e) => {
  console.error(String(e.message).slice(0, 400));
  try { await client.end(); } catch { /* already closed */ }
  process.exit(1);
});
