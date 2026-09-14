/**
 * Apply 20260911_stakeholder_work_assignment.
 *
 * WHAT IT DOES TO THE DATABASE
 *   - adds two NULLABLE columns (assigned_to_id, assigned_at). Nullable with no
 *     default is a catalogue-only change in Postgres 11+, so no table rewrite.
 *   - adds a foreign key NOT VALID, then validates it. Validated-on-add would scan
 *     the whole table holding a lock; this way the scan does not block writes.
 *   - creates two indexes. This is the only part that takes real time — a brief
 *     write lock on ~295K rows, expect a second or two.
 *
 * Every statement is guarded (IF NOT EXISTS / pg_constraint check), so re-running
 * is safe and does nothing the second time.
 *
 *   npx tsx scripts/apply-assignment-migration.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/config/database';

const MIGRATION = path.join(
  __dirname, '..', 'prisma', 'migrations', '20260911_stakeholder_work_assignment', 'migration.sql'
);

async function state() {
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'stakeholders'
       AND column_name IN ('assigned_to_id', 'assigned_at')
     ORDER BY column_name`
  );
  const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'stakeholders' AND indexname LIKE '%assigned%'
     ORDER BY indexname`
  );
  const fk = await prisma.$queryRawUnsafe<{ conname: string; convalidated: boolean }[]>(
    `SELECT conname, convalidated FROM pg_constraint
     WHERE conname = 'stakeholders_assigned_to_id_fkey'`
  );
  return {
    columns: cols.map(c => c.column_name),
    indexes: idx.map(i => i.indexname),
    fk: fk.map(f => `${f.conname}(validated=${f.convalidated})`),
  };
}

async function main() {
  console.log('=== before ===');
  console.log(JSON.stringify(await state(), null, 2));

  const sql = fs.readFileSync(MIGRATION, 'utf8');

  // Split on semicolons at end of line, but keep the DO $$ ... $$ block intact —
  // it contains semicolons that are part of its body, and splitting them would
  // produce syntax errors.
  const statements: string[] = [];
  let buffer = '';
  let inDollarBlock = false;
  for (const line of sql.split('\n')) {
    if (/^\s*DO \$\$/.test(line)) inDollarBlock = true;
    buffer += line + '\n';
    if (inDollarBlock) {
      if (/^\s*END \$\$;/.test(line)) {
        inDollarBlock = false;
        statements.push(buffer);
        buffer = '';
      }
      continue;
    }
    if (/;\s*$/.test(line) && !/^\s*--/.test(line)) {
      statements.push(buffer);
      buffer = '';
    }
  }
  if (buffer.trim()) statements.push(buffer);

  const runnable = statements
    .map(s => s.split('\n').filter(l => !/^\s*--/.test(l)).join('\n').trim())
    .filter(s => s.length > 0);

  console.log(`\n=== applying ${runnable.length} statement(s) ===`);
  for (const stmt of runnable) {
    const label = stmt.replace(/\s+/g, ' ').slice(0, 90);
    const t0 = Date.now();
    await prisma.$executeRawUnsafe(stmt);
    console.log(`  ok (${Date.now() - t0}ms)  ${label}…`);
  }

  const after = await state();
  console.log('\n=== after ===');
  console.log(JSON.stringify(after, null, 2));

  const ok =
    after.columns.length === 2 &&
    after.indexes.length >= 2 &&
    after.fk.length === 1 &&
    after.fk[0]!.includes('validated=true');

  // Nothing may be assigned yet: every row starts in the pool.
  const assigned = await prisma.stakeholder.count({ where: { assignedToId: { not: null } } });
  console.log(`\nrows already assigned: ${assigned} (expected 0 on a fresh migration)`);

  console.log(`\n=== ${ok ? 'MIGRATION APPLIED' : 'INCOMPLETE — check output above'} ===`);
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
