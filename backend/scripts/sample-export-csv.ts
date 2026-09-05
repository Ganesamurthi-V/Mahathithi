/**
 * Produce a real CSV sample from live survey data so the format can be inspected
 * in Excel, and assert it contains no SQL artefacts.
 *
 * READ-ONLY. It calls generateExportCSV directly instead of going through the HTTP
 * route, so no survey_exports rows and no audit entries are written and nothing
 * flips from "New" to "Exported".
 *
 *   npx tsx scripts/sample-export-csv.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { prisma } from '../src/config/database';
import { generateExportCSV } from '../src/modules/admin/admin.routes';

const OUT = path.join(process.cwd(), 'sample-survey-export.csv');

async function main() {
  const surveys = await prisma.survey.findMany({
    where: { isCompleted: true, isDraft: false },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`completed surveys found: ${surveys.length}`);
  if (surveys.length === 0) throw new Error('no completed surveys');

  // Same media lookup the real export uses, so the sample is representative.
  const media = await prisma.media.findMany({
    where: { surveyId: { in: surveys.map(s => s.id) }, deletedAt: null, type: { in: ['PHOTO', 'DOCUMENT'] } },
    select: { surveyId: true, type: true, photoCategory: true, filePath: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const mediaBySurvey = new Map<string, any[]>();
  for (const m of media) {
    const list = mediaBySurvey.get(m.surveyId);
    if (list) list.push(m); else mediaBySurvey.set(m.surveyId, [m]);
  }

  const csv = generateExportCSV(surveys, mediaBySurvey);
  fs.writeFileSync(OUT, csv, 'utf8');
  console.log(`written: ${OUT}  (${Buffer.byteLength(csv, 'utf8')} bytes)\n`);

  // ---- assert it is a plain table, with nothing SQL-shaped in it ----------
  const rows: string[][] = parse(csv.replace(/^\uFEFF/, ''), { skipEmptyLines: true });
  const header = rows[0]!;

  const sqlMarkers = [
    'BEGIN;', 'COMMIT;', 'INSERT INTO', 'WITH new_listing', 'gen_random_uuid',
    'RETURNING', '::uuid', '-- ====',
  ];
  const found = sqlMarkers.filter(m => csv.includes(m));

  console.log('=== assertions ===');
  console.log(`  ${found.length === 0 ? 'PASS' : 'FAIL'}  contains no SQL artefacts${found.length ? ` — found ${found.join(', ')}` : ''}`);
  console.log(`  ${rows.length === surveys.length + 1 ? 'PASS' : 'FAIL'}  one row per survey plus a header (${rows.length} rows for ${surveys.length} surveys)`);
  console.log(`  ${rows.every(r => r.length === header.length) ? 'PASS' : 'FAIL'}  every row has exactly ${header.length} columns`);
  const noCommentRows = !rows.some(r => r[0]!.startsWith('--'));
  console.log(`  ${noCommentRows ? 'PASS' : 'FAIL'}  no comment rows`);

  // ---- show it ------------------------------------------------------------
  console.log(`\n=== ${header.length} columns ===`);
  header.forEach((h, i) => console.log(`  ${String(i + 1).padStart(2)}. ${h}`));

  console.log('\n=== first data row, field by field ===');
  const first = rows[1]!;
  header.forEach((h, i) => {
    const v = first[i] ?? '';
    const shown = v.length > 70 ? v.slice(0, 67) + '...' : v;
    console.log(`  ${h.padEnd(28)} ${shown === '' ? '(empty)' : shown}`);
  });

  console.log('\n=== raw first 2 lines as they appear in the file ===');
  const rawLines = csv.replace(/^\uFEFF/, '').split('\r\n');
  console.log(rawLines[0]!.slice(0, 240));
  console.log(rawLines[1]!.slice(0, 240));

  await prisma.$disconnect();
  process.exit(found.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
