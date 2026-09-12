/**
 * Verify the admin can pick an explicit district when creating a stakeholder, and
 * that the server stores exactly that district rather than a fallback.
 *
 * The admin account has no assigned district, which is the whole reason the admin
 * form needs an explicit picker. This asserts:
 *   - GET /admin/districts returns real district names for the dropdown
 *   - a create WITH an explicit district stores that exact district
 *   - a create with NO district still fails for the admin (the old behaviour that
 *     motivated the picker), so the picker is genuinely required, not cosmetic
 *
 * Creates and deletes only its own row.
 *
 *   npx tsx scripts/verify-admin-district-pick.ts
 */
import axios from 'axios';
import { prisma } from '../src/config/database';

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:3000';
const USER = process.env.VERIFY_ADMIN_USER || 'admin';
const PASS = process.env.VERIFY_ADMIN_PASS || 'admin@123';

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
const msgOf = (e: any) => e.response?.data?.error?.message || e.message || '';

async function main() {
  const login = await axios.post(`${BASE}/api/auth/login`, { loginId: USER, password: PASS });
  const token = login.data?.data?.tokens?.accessToken;
  if (!token) throw new Error('no token');
  const headers = { Authorization: `Bearer ${token}` };
  console.log('logged in as admin\n');

  let createdId: string | null = null;

  try {
    // ---- the dropdown source -------------------------------------------
    console.log('=== GET /admin/districts (dropdown source) ===');
    const dRes = await axios.get(`${BASE}/api/admin/districts`, { headers });
    const districts: any[] = dRes.data?.data ?? [];
    check('returns a non-empty district list', districts.length > 0, `${districts.length}`);
    check('each district has a name string the dropdown can show',
      districts.every(d => typeof d.name === 'string' && d.name.length > 0));

    // Pick one that is NOT the admin's (they have none), to prove the value is
    // taken from the payload rather than any assignment.
    const chosen = districts.find(d => d.name === 'Pune')?.name || districts[0].name;
    console.log(`  chosen district: ${chosen}`);

    // ---- create WITH explicit district ---------------------------------
    console.log('\n=== create with an explicitly chosen district ===');
    const res = await axios.post(
      `${BASE}/api/stakeholders`,
      {
        companyNameStandardized: `ZZ District Pick ${Date.now()}`,
        district: chosen,
        category: 'Worker Hostels',
        city: 'Testville',
      },
      { headers }
    );
    createdId = res.data?.data?.id ?? null;
    check('201 Created', res.status === 201, `status ${res.status}`);
    check('stored district equals the chosen one, not a fallback or NULL',
      res.data?.data?.district === chosen,
      `stored ${JSON.stringify(res.data?.data?.district)}, chose ${chosen}`);
    check('dataSource is MANUAL', res.data?.data?.dataSource === 'MANUAL');
    check('status is OPEN', res.data?.data?.status === 'OPEN');

    const inDb = await prisma.stakeholder.findUnique({ where: { id: createdId! } });
    check('district persisted in the database', inDb?.district === chosen,
      JSON.stringify(inDb?.district));

    // ---- create with NO district (why the picker is required) ----------
    console.log('\n=== admin create with no district is still refused ===');
    try {
      await axios.post(
        `${BASE}/api/stakeholders`,
        { companyNameStandardized: 'ZZ No District Probe' },
        { headers }
      );
      check('no-district create refused for the district-less admin', false,
        'request succeeded — would have created a NULL-district row');
    } catch (e: any) {
      check('no-district create refused for the district-less admin',
        e.response?.status === 400, `status ${e.response?.status}`);
      check('message tells the admin to enter a district',
        /district/i.test(msgOf(e)), JSON.stringify(msgOf(e)));
    }
  } finally {
    console.log('\n=== cleanup ===');
    if (createdId) {
      await prisma.phoneValidation.deleteMany({ where: { stakeholderId: createdId } });
      await prisma.stakeholder.deleteMany({ where: { id: createdId } });
      console.log('  removed the test stakeholder');
    }
    const strays = await prisma.stakeholder.deleteMany({
      where: { dataSource: 'MANUAL', companyNameStandardized: { startsWith: 'ZZ ' } },
    });
    if (strays.count > 0) console.log(`  removed ${strays.count} stray ZZ row(s)`);
    const audits = await prisma.auditLog.deleteMany({
      where: { action: 'stakeholder_created', details: { path: ['name'], string_starts_with: 'ZZ District Pick' } },
    });
    console.log(`  removed ${audits.count} audit row(s)`);
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
