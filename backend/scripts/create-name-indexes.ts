/**
 * Builds the stakeholder name indexes, one at a time, and checks each came out valid.
 *
 *   npx tsx scripts/create-name-indexes.ts
 *
 * Why a script, and why the plain `pg` driver: CREATE INDEX CONCURRENTLY (which does not block
 * readers or writers, so field devices keep working) cannot run inside a transaction. Prisma's raw
 * queries are wrapped in one, and some SQL editors wrap every run in one too. Here each statement
 * is sent on its own connection as a single statement, which is allowed.
 *
 * Safe to run again: every statement is IF NOT EXISTS, and an index that a previous interrupted
 * run left INVALID is dropped and rebuilt.
 *
 * Needs the sh_name_key function first (prisma/migrations/20261105_sh_name_key_function).
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

const MIGRATIONS = [
  { dir: '20261105_sh_name_key_district_idx', index: 'stakeholders_name_key_district_idx' },
  { dir: '20261105_sh_name_prefix_idx', index: 'stakeholders_name_prefix_idx' },
  { dir: '20261105_sh_name_trgm_std_idx', index: 'stakeholders_name_trgm_std_idx' },
  { dir: '20261105_sh_name_trgm_orig_idx', index: 'stakeholders_name_trgm_orig_idx' },
];

function statementOf(dir: string): string {
  const file = path.join(__dirname, '..', 'prisma', 'migrations', dir, 'migration.sql');
  const sql = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim()
    .replace(/;\s*$/, '');
  if (!/^CREATE INDEX CONCURRENTLY IF NOT EXISTS/i.test(sql) || sql.includes(';')) {
    throw new Error(`${dir}: expected exactly one CREATE INDEX CONCURRENTLY statement`);
  }
  return sql;
}

/** DATABASE_URL without the Prisma-only query parameters (pgbouncer, connection_limit, schema). */
function connectionString(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set');
  const url = new URL(raw);
  url.search = '';
  return url.toString();
}

async function state(db: Client, index: string): Promise<'missing' | 'valid' | 'invalid'> {
  const { rows } = await db.query<{ indisvalid: boolean }>(
    'SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1',
    [index],
  );
  if (rows.length === 0) return 'missing';
  return rows[0].indisvalid ? 'valid' : 'invalid';
}

async function main() {
  const db = new Client({ connectionString: connectionString(), ssl: { rejectUnauthorized: false } });
  await db.connect();

  try {
    const fn = await db.query<{ ok: boolean }>(`SELECT to_regprocedure('sh_name_key(text,text)') IS NOT NULL AS ok`);
    if (!fn.rows[0]?.ok) {
      console.error('The sh_name_key function does not exist yet. Apply prisma/migrations/20261105_sh_name_key_function first.');
      process.exit(1);
    }

    for (const { dir, index } of MIGRATIONS) {
      const before = await state(db, index);
      if (before === 'valid') {
        console.log(`ok       ${index} (already exists)`);
        continue;
      }
      if (before === 'invalid') {
        console.log(`rebuild  ${index} (a previous run left it invalid)`);
        await db.query(`DROP INDEX CONCURRENTLY IF EXISTS "${index}"`);
      }

      const started = Date.now();
      process.stdout.write(`build    ${index} ... `);
      await db.query(statementOf(dir));
      const after = await state(db, index);
      console.log(`${after} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      if (after !== 'valid') {
        console.error(`${index} did not come out valid. Run the script again.`);
        process.exitCode = 1;
      }
    }

    await db.query('ANALYZE stakeholders');
    console.log('done');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('failed:', err?.message ?? err);
  console.error('If this was a statement timeout, run the same CREATE INDEX statement through a direct (non-pooler) connection.');
  process.exit(1);
});
