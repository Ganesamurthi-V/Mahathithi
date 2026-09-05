/**
 * End-to-end check of the survey export HTTP layer, for both formats.
 *
 * WHY THIS RESTORES STATE
 * A successful export deliberately has a side effect: it writes survey_exports
 * rows (flipping the row from "New" to "Exported" in the panel) and an audit log
 * entry. This script therefore snapshots the survey_exports row for the single
 * survey it tests, and puts it back byte for byte afterwards — including the
 * original exportedAt, which is what the panel displays. The audit row it creates
 * is removed too.
 *
 * Anything it cannot fully undo, it does not do: it never exports more than one
 * survey, and never uses the export-everything route.
 *
 *   npx tsx scripts/verify-export-endpoint.ts
 */
import axios from 'axios';
import { parse } from 'csv-parse/sync';
import { prisma } from '../src/config/database';

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:3000';
const USER = process.env.VERIFY_ADMIN_USER || 'admin';
const PASS = process.env.VERIFY_ADMIN_PASS || 'admin@123';

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

/**
 * Read a response header as a plain string.
 *
 * Axios types header values as string | number | boolean | string[] | null, so
 * passing one straight into a regex test or a string parameter does not typecheck
 * under --strict. Normalising once here keeps the assertions readable.
 */
function resHeader(res: { headers: any }, name: string): string {
  const v = res.headers?.[name];
  if (v === undefined || v === null) return '';
  return Array.isArray(v) ? v.join(', ') : String(v);
}

async function main() {
  // ---- auth -------------------------------------------------------------
  const login = await axios.post(`${BASE}/api/auth/login`, {
    loginId: USER,
    password: PASS,
  });
  const token =
    login.data?.data?.tokens?.accessToken ||
    login.data?.tokens?.accessToken ||
    login.data?.data?.accessToken ||
    login.data?.accessToken;
  if (!token) throw new Error(`no token in login response: ${JSON.stringify(login.data).slice(0, 300)}`);
  const auth = { Authorization: `Bearer ${token}` };
  console.log('logged in\n');

  // ---- pick one completed survey ---------------------------------------
  const survey = await prisma.survey.findFirst({
    where: { isCompleted: true, isDraft: false },
    select: { id: true, businessName: true, aadharNumber: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!survey) throw new Error('no completed survey available to test with');
  console.log(`test survey: ${survey.id} (${survey.businessName ?? 'unnamed'})`);
  console.log(`aadhaar in DB: ${survey.aadharNumber ? `${survey.aadharNumber.length} chars` : 'null'}\n`);

  // ---- snapshot the state this test will disturb ------------------------
  const priorExport = await prisma.surveyExport.findUnique({ where: { surveyId: survey.id } });
  const auditIdsBefore = (await prisma.auditLog.findMany({
    where: { action: 'surveys_exported' },
    select: { id: true },
  })).map(a => a.id);
  console.log(`snapshot: survey_exports row ${priorExport ? 'EXISTS' : 'absent'}, ${auditIdsBefore.length} prior export audit rows\n`);

  try {
    // ---- negative paths (no side effects) ------------------------------
    console.log('=== rejections ===');

    try {
      await axios.get(`${BASE}/api/admin/export/surveys?format=csv`);
      check('unauthenticated request is rejected', false, 'request succeeded');
    } catch (e: any) {
      check('unauthenticated request is rejected', e.response?.status === 401,
        `status ${e.response?.status}`);
    }

    try {
      await axios.post(`${BASE}/api/admin/export/surveys`,
        { ids: [survey.id], format: 'xlsx' }, { headers: auth });
      check('unknown format is rejected rather than silently defaulting', false, 'request succeeded');
    } catch (e: any) {
      const msg = e.response?.data?.error?.message || '';
      check('unknown format is rejected rather than silently defaulting',
        e.response?.status === 400, `status ${e.response?.status}`);
      check('rejection names the supported formats', /sql/i.test(msg) && /csv/i.test(msg),
        JSON.stringify(msg));
    }

    try {
      await axios.post(`${BASE}/api/admin/export/surveys`,
        { ids: ['00000000-0000-0000-0000-000000000000'], format: 'csv' }, { headers: auth });
      check('non-existent ids give 404 (format reached the handler)', false, 'request succeeded');
    } catch (e: any) {
      check('non-existent ids give 404 (format reached the handler)',
        e.response?.status === 404, `status ${e.response?.status}`);
    }

    // ---- the real CSV download ----------------------------------------
    console.log('\n=== CSV download ===');
    // arraybuffer, NOT text. Axios decodes a text response with TextDecoder, which
    // strips a leading BOM by default — asserting on the decoded string reports a
    // missing BOM even when the server sent one — confirmed by reading the raw
    // socket, which showed ef bb bf present. Only the bytes tell the truth here.
    const res = await axios.post(
      `${BASE}/api/admin/export/surveys`,
      { ids: [survey.id], format: 'csv' },
      { headers: auth, responseType: 'arraybuffer' }
    );

    const csvType = resHeader(res, 'content-type');
    const csvDisposition = resHeader(res, 'content-disposition');

    check('200 OK', res.status === 200, `status ${res.status}`);
    check('Content-Type is text/csv', /text\/csv/i.test(csvType), csvType);
    check('charset=utf-8 declared', /charset=utf-8/i.test(csvType), csvType);
    check('Content-Disposition filename ends in .csv',
      /filename="[^"]+\.csv"/.test(csvDisposition), csvDisposition);

    const raw = Buffer.from(res.data);
    check('body begins with UTF-8 BOM bytes ef bb bf (Excel reads UTF-8)',
      raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf,
      `first 3 bytes: ${[...raw.subarray(0, 3)].map(b => b.toString(16)).join(' ')}`);

    const text: string = raw.toString('utf8');

    const rows: string[][] = parse(text.replace(/^\uFEFF/, ''), { skipEmptyLines: true });
    check('exactly one data row for one requested survey', rows.length === 2,
      `${rows.length} parsed rows`);

    const header = rows[0]!;
    const row = rows[1]!;
    check('all rows match header width', row.length === header.length,
      `header ${header.length} vs row ${row.length}`);
    check('survey_id matches the requested survey',
      row[header.indexOf('survey_id')] === survey.id,
      row[header.indexOf('survey_id')]);

    // Aadhaar: verify the CSV carries exactly what the DB holds, unmasked.
    const csvAadhaar = row[header.indexOf('aadhar_number')]!;
    if (survey.aadharNumber) {
      check('aadhaar exported in full, identical to the DB value',
        csvAadhaar === survey.aadharNumber,
        `csv=${JSON.stringify(csvAadhaar)} db=${JSON.stringify(survey.aadharNumber)}`);
      check('aadhaar not masked', !/[X*]/i.test(csvAadhaar), csvAadhaar);
    } else {
      check('aadhaar empty in CSV because it is null in the DB', csvAadhaar === '',
        JSON.stringify(csvAadhaar));
      console.log('        (this survey has no aadhaar stored, so the full-value path' +
        ' is covered by verify-export-csv.ts instead)');
    }

    // ---- SQL still works, unchanged ------------------------------------
    console.log('\n=== SQL not regressed ===');
    const sqlRes = await axios.post(
      `${BASE}/api/admin/export/surveys`,
      { ids: [survey.id] },
      { headers: auth, responseType: 'text', transformResponse: [(d) => d] }
    );
    const sqlType = resHeader(sqlRes, 'content-type');
    const sqlDisposition = resHeader(sqlRes, 'content-disposition');

    check('defaults to SQL when no format is given',
      /application\/sql/i.test(sqlType), sqlType);
    check('SQL filename ends in .sql',
      /filename="[^"]+\.sql"/.test(sqlDisposition), sqlDisposition);
    check('SQL body still wrapped in a transaction',
      String(sqlRes.data).includes('BEGIN;') && String(sqlRes.data).includes('COMMIT;'));
    check('SQL export does NOT contain the aadhaar number',
      !survey.aadharNumber || !String(sqlRes.data).includes(survey.aadharNumber));

    // Marking happens on response finish, which may land just after the client
    // has the body. Give it a moment before asserting.
    await new Promise(r => setTimeout(r, 2500));
    const marked = await prisma.surveyExport.findUnique({ where: { surveyId: survey.id } });
    check('survey recorded as exported after delivery', marked !== null);
  } finally {
    // ---- restore ------------------------------------------------------
    console.log('\n=== restoring state ===');

    // Both exports above mark on their response's `finish` event, which fires
    // slightly after the client has the body. Without this wait the cleanup races
    // the SQL export's marking write: the delete lands first, the late insert
    // re-creates the row, and the NEXT run reads that as pre-existing state and
    // faithfully preserves it. That is how a previous run left a survey marked
    // exported when it had not been. Drain the handlers before undoing anything.
    await new Promise(r => setTimeout(r, 3000));

    await prisma.surveyExport.deleteMany({ where: { surveyId: survey.id } });
    if (priorExport) {
      await prisma.surveyExport.create({
        data: {
          id: priorExport.id,
          surveyId: priorExport.surveyId,
          exportedAt: priorExport.exportedAt,
          exportedBy: priorExport.exportedBy,
        },
      });
      console.log(`  restored survey_exports row (exportedAt ${priorExport.exportedAt.toISOString()})`);
    } else {
      console.log('  removed the survey_exports row this test created');
    }

    const removed = await prisma.auditLog.deleteMany({
      where: { action: 'surveys_exported', id: { notIn: auditIdsBefore } },
    });
    console.log(`  removed ${removed.count} audit row(s) created by this test`);

    const after = await prisma.surveyExport.findUnique({ where: { surveyId: survey.id } });
    const sameAsBefore = priorExport
      ? after !== null && after.exportedAt.getTime() === priorExport.exportedAt.getTime()
      : after === null;
    console.log(`  state matches snapshot: ${sameAsBefore ? 'YES' : 'NO'}`);
    if (!sameAsBefore) failures++;

    await prisma.$disconnect();
  }

  console.log(`\n=== ${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('\nERROR:', e.response?.status || '', e.response?.data || e.message);
  await prisma.$disconnect();
  process.exit(1);
});
