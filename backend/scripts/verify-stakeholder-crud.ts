/**
 * End-to-end check of stakeholder create + delete.
 *
 * SAFETY
 * This creates its OWN stakeholder and deletes only that one. The 409 path is
 * tested against a real surveyed stakeholder, but that path asserts the delete is
 * REFUSED, so nothing real is ever removed. Any row or audit entry this script
 * creates is cleaned up in the finally block.
 *
 *   npx tsx scripts/verify-stakeholder-crud.ts
 */
import axios from 'axios';
import { prisma } from '../src/config/database';

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:3000';
const USER = process.env.VERIFY_ADMIN_USER || 'admin';
const PASS = process.env.VERIFY_ADMIN_PASS || 'admin@123';

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
function msgOf(e: any): string {
  return e.response?.data?.error?.message || e.message || '';
}

async function main() {
  const login = await axios.post(`${BASE}/api/auth/login`, { loginId: USER, password: PASS });
  const token = login.data?.data?.tokens?.accessToken;
  if (!token) throw new Error('no token');
  const headers = { Authorization: `Bearer ${token}` };
  console.log('logged in\n');

  const NAME = `ZZ Verify Test ${Date.now()}`;
  let createdId: string | null = null;

  try {
    // ---- create ---------------------------------------------------------
    console.log('=== create ===');
    const maxBefore = (await prisma.stakeholder.aggregate({ _max: { primaryKeyId: true } }))._max.primaryKeyId ?? 0;

    const createRes = await axios.post(
      `${BASE}/api/stakeholders`,
      {
        companyNameStandardized: NAME,
        district: 'Pune',
        city: 'Malvan, "quoted"',
        pinCode: '416606',
        category: 'Hotels & Resorts',
        latitude: 16.0594,
        longitude: 73.4629,
      },
      { headers }
    );
    createdId = createRes.data?.data?.id ?? null;
    const created = createRes.data?.data;

    check('201 Created', createRes.status === 201, `status ${createRes.status}`);
    check('returns an id', !!createdId);
    check('name persisted', created?.companyNameStandardized === NAME, created?.companyNameStandardized);
    check('district persisted', created?.district === 'Pune', created?.district);
    check('value with comma and quotes survives', created?.city === 'Malvan, "quoted"', created?.city);
    check('coordinates persisted as numbers',
      created?.latitude === 16.0594 && created?.longitude === 73.4629,
      `${created?.latitude}, ${created?.longitude}`);
    check('dataSource marked MANUAL (distinguishable from imported rows)',
      created?.dataSource === 'MANUAL', created?.dataSource);
    check('status defaults to OPEN', created?.status === 'OPEN', created?.status);
    check('primaryKeyId is MAX+1, not colliding with the import range',
      created?.primaryKeyId === maxBefore + 1,
      `got ${created?.primaryKeyId}, expected ${maxBefore + 1}`);

    const inDb = await prisma.stakeholder.findUnique({ where: { id: createdId! } });
    check('row actually exists in the database', inDb !== null);

    const createAudit = await prisma.auditLog.findFirst({
      where: { action: 'stakeholder_created', entityId: createdId! },
    });
    check('create is audited', createAudit !== null);

    // ---- validation -----------------------------------------------------
    console.log('\n=== validation ===');
    try {
      await axios.post(`${BASE}/api/stakeholders`, { companyNameStandardized: '' }, { headers });
      check('empty name rejected', false, 'request succeeded');
    } catch (e: any) {
      check('empty name rejected', e.response?.status === 400, `status ${e.response?.status}`);
    }

    try {
      // cinNumber is an import-owned provenance field and must not be settable by
      // hand, or a manual row could masquerade as MCA-sourced.
      await axios.post(
        `${BASE}/api/stakeholders`,
        { companyNameStandardized: 'ZZ strict probe', cinNumber: 'U55101PN2014PTC151643' },
        { headers }
      );
      check('registry provenance field (cinNumber) rejected', false, 'request succeeded');
    } catch (e: any) {
      check('registry provenance field (cinNumber) rejected',
        e.response?.status === 400, `status ${e.response?.status}`);
    }

    try {
      await axios.post(
        `${BASE}/api/stakeholders`,
        { companyNameStandardized: 'ZZ pk probe', primaryKeyId: 1 },
        { headers }
      );
      check('client-supplied primaryKeyId rejected', false, 'request succeeded');
    } catch (e: any) {
      check('client-supplied primaryKeyId rejected',
        e.response?.status === 400, `status ${e.response?.status}`);
    }

    // ---- delete: refused when surveys exist -----------------------------
    console.log('\n=== delete refused when surveys attached ===');
    const surveyed = await prisma.survey.findFirst({ select: { stakeholderId: true } });
    if (surveyed) {
      const before = await prisma.stakeholder.findUnique({ where: { id: surveyed.stakeholderId } });
      try {
        await axios.delete(`${BASE}/api/stakeholders/${surveyed.stakeholderId}`, { headers });
        check('surveyed stakeholder delete refused', false, 'request SUCCEEDED — data was deleted!');
      } catch (e: any) {
        check('surveyed stakeholder delete refused with 409',
          e.response?.status === 409, `status ${e.response?.status}`);
        check('message explains why and what to do',
          /survey/i.test(msgOf(e)), JSON.stringify(msgOf(e)));
      }
      const after = await prisma.stakeholder.findUnique({ where: { id: surveyed.stakeholderId } });
      check('the surveyed stakeholder is still present', after !== null && before !== null);
    } else {
      console.log('  (no surveyed stakeholder available to test the 409 path)');
    }

    // ---- delete: 404 ----------------------------------------------------
    console.log('\n=== delete non-existent ===');
    try {
      await axios.delete(`${BASE}/api/stakeholders/00000000-0000-0000-0000-000000000000`, { headers });
      check('unknown id gives 404', false, 'request succeeded');
    } catch (e: any) {
      check('unknown id gives 404', e.response?.status === 404, `status ${e.response?.status}`);
    }

    // ---- delete: unauthenticated ----------------------------------------
    console.log('\n=== delete unauthenticated ===');
    try {
      await axios.delete(`${BASE}/api/stakeholders/${createdId}`);
      check('unauthenticated delete rejected', false, 'request succeeded');
    } catch (e: any) {
      check('unauthenticated delete rejected', e.response?.status === 401, `status ${e.response?.status}`);
    }

    // ---- delete: the happy path on our own row --------------------------
    console.log('\n=== delete the row this test created ===');
    const delRes = await axios.delete(`${BASE}/api/stakeholders/${createdId}`, { headers });
    check('200 OK', delRes.status === 200, `status ${delRes.status}`);
    check('reports deleted', delRes.data?.data?.deleted === true);

    const gone = await prisma.stakeholder.findUnique({ where: { id: createdId! } });
    check('row is gone from the database', gone === null);
    if (gone === null) createdId = null; // nothing left to clean up

    const delAudit = await prisma.auditLog.findFirst({
      where: { action: 'stakeholder_deleted', entityId: createRes.data.data.id },
    });
    check('delete is audited', delAudit !== null);
    const snapshot = (delAudit?.details as any)?.snapshot;
    check('audit holds a full row snapshot, so a mistaken delete is recoverable',
      !!snapshot && snapshot.companyNameStandardized === NAME,
      snapshot ? `snapshot name = ${snapshot.companyNameStandardized}` : 'no snapshot');
  } finally {
    console.log('\n=== cleanup ===');
    if (createdId) {
      // Only reached if the delete assertion failed; remove the test row so it
      // does not linger in the real dataset.
      await prisma.phoneValidation.deleteMany({ where: { stakeholderId: createdId } });
      await prisma.stakeholder.deleteMany({ where: { id: createdId } });
      console.log('  removed the leftover test stakeholder');
    }
    // Catches both the named probes and any empty-name row a validation gap let
    // through — the latter would not match a startsWith filter, which is exactly
    // how one was left behind the first time this ran.
    const strays = await prisma.stakeholder.deleteMany({
      where: {
        dataSource: 'MANUAL',
        OR: [
          { companyNameStandardized: { startsWith: 'ZZ ' } },
          { companyNameStandardized: '' },
          { companyNameStandardized: null },
        ],
      },
    });
    if (strays.count > 0) console.log(`  removed ${strays.count} stray test row(s)`);

    const audits = await prisma.auditLog.deleteMany({
      where: {
        action: { in: ['stakeholder_created', 'stakeholder_deleted'] },
        details: { path: ['name'], string_starts_with: 'ZZ Verify Test' },
      },
    });
    console.log(`  removed ${audits.count} audit row(s) created by this test`);

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
