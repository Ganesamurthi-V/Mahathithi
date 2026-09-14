/**
 * Verify POST /api/stakeholders/claim over HTTP.
 *
 * Covers the guards rather than the claim maths (which verify-work-assignment.ts
 * proves against the service directly): authentication, the admin refusal, and that
 * a claim is reported in a shape the mobile app can act on.
 *
 * Uses a real enumerator by temporarily setting a known password on a throwaway
 * account it creates, so it can exercise the endpoint as a field device would. The
 * account and any claims it makes are removed afterwards.
 *
 *   npx tsx scripts/verify-claim-endpoint.ts
 */
import axios from 'axios';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/config/database';
import { WORK_QUOTA } from '../src/utils/stakeholder-assignment';

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:3000';

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
const msgOf = (e: any) => e.response?.data?.error?.message || e.message || '';

async function main() {
  const PASSWORD = 'Cl4im!Verify99';
  const loginId = `zz_claim_${Date.now()}`;
  let enumeratorId: string | null = null;

  try {
    // ---- unauthenticated -------------------------------------------------
    console.log('=== guards ===');
    try {
      await axios.post(`${BASE}/api/stakeholders/claim`);
      check('unauthenticated claim rejected', false, 'request succeeded');
    } catch (e: any) {
      check('unauthenticated claim rejected', e.response?.status === 401, `status ${e.response?.status}`);
    }

    // ---- admin refused ---------------------------------------------------
    const adminLogin = await axios.post(`${BASE}/api/auth/login`, {
      loginId: 'admin', password: 'admin@123',
    });
    const adminHeaders = { Authorization: `Bearer ${adminLogin.data.data.tokens.accessToken}` };
    try {
      await axios.post(`${BASE}/api/stakeholders/claim`, {}, { headers: adminHeaders });
      check('admin claim refused (admins hold no work queue)', false, 'request succeeded');
    } catch (e: any) {
      check('admin claim refused (admins hold no work queue)',
        e.response?.status === 400, `status ${e.response?.status}`);
      check('refusal explains why', /admin/i.test(msgOf(e)), JSON.stringify(msgOf(e)));
    }

    // ---- a real field enumerator ----------------------------------------
    console.log('\n=== as a field enumerator ===');
    const district = await prisma.district.findFirst({
      where: { name: 'Sindhudurg' },
      select: { id: true, name: true },
    }) ?? await prisma.district.findFirst({ select: { id: true, name: true } });
    if (!district) throw new Error('no districts');

    const created = await prisma.enumerator.create({
      data: {
        loginId,
        name: 'ZZ Claim Probe',
        passwordHash: await bcrypt.hash(PASSWORD, 12),
        isActive: true,
        isAdmin: false,
        districts: { create: [{ districtId: district.id }] },
      },
      select: { id: true },
    });
    enumeratorId = created.id;
    console.log(`  created ${loginId} assigned to ${district.name}`);

    const login = await axios.post(`${BASE}/api/auth/login`, { loginId, password: PASSWORD });
    const headers = { Authorization: `Bearer ${login.data.data.tokens.accessToken}` };

    const res = await axios.post(`${BASE}/api/stakeholders/claim`, {}, { headers });
    const d = res.data?.data ?? {};
    console.log(`  claimed=${d.claimed} held=${d.held} quota=${d.quota} poolRemaining=${d.poolRemaining} full=${d.full}`);

    check('200 OK', res.status === 200, `status ${res.status}`);
    check('quota reported is WORK_QUOTA', d.quota === WORK_QUOTA, `${d.quota}`);
    check('claimed something from a non-empty pool', d.claimed > 0, `${d.claimed}`);
    check('never exceeds the quota', d.held <= WORK_QUOTA, `held ${d.held}`);
    check('held equals what was claimed on a fresh account',
      d.held === d.claimed, `held ${d.held} vs claimed ${d.claimed}`);
    check('response carries the fields the app needs to decide on a top-up',
      ['claimed', 'held', 'quota', 'poolRemaining', 'full'].every(k => k in d),
      JSON.stringify(Object.keys(d)));

    const inDb = await prisma.stakeholder.count({ where: { assignedToId: enumeratorId } });
    check('the claims are real rows in the database', inDb === d.claimed, `${inDb} vs ${d.claimed}`);

    // Everything claimed must be inside their district — a device must never be
    // handed work it cannot legitimately see.
    const outside = await prisma.stakeholder.count({
      where: { assignedToId: enumeratorId, district: { not: district.name } },
    });
    check('nothing was claimed outside the assigned district', outside === 0, `${outside}`);

    // ---- the paged feed now returns the claimed work --------------------
    const paged = await axios.get(`${BASE}/api/stakeholders/assigned/paged`, {
      headers, params: { after: 0, page_size: 50 },
    });
    const rows = paged.data?.data?.stakeholders ?? [];
    check('the download feed returns the claimed work', rows.length > 0, `${rows.length} row(s)`);
    const allMine = rows.every((r: any) => r.assignedToId === enumeratorId);
    check('every downloaded row is assigned to this enumerator', allMine);

    // ---- a second claim is a no-op while the pool/quota allow nothing new
    const second = await axios.post(`${BASE}/api/stakeholders/claim`, {}, { headers });
    const d2 = second.data?.data ?? {};
    check('a repeat claim does not double-assign',
      d2.held === d.held || d2.claimed === 0,
      `first held ${d.held}, second held ${d2.held}, claimed ${d2.claimed}`);
  } finally {
    console.log('\n=== cleanup ===');
    if (enumeratorId) {
      const released = await prisma.stakeholder.updateMany({
        where: { assignedToId: enumeratorId },
        data: { assignedToId: null, assignedAt: null },
      });
      console.log(`  released ${released.count} claim(s)`);
      await prisma.enumeratorDistrict.deleteMany({ where: { enumeratorId } });
      await prisma.session.deleteMany({ where: { enumeratorId } });
      await prisma.enumerator.deleteMany({ where: { id: enumeratorId } });
      console.log('  removed the probe account');
    }
    const strays = await prisma.enumerator.deleteMany({ where: { loginId: { startsWith: 'zz_claim_' } } });
    if (strays.count > 0) console.log(`  removed ${strays.count} stray probe account(s)`);

    const leftover = await prisma.stakeholder.count({ where: { assignedToId: { not: null } } });
    console.log(`  assigned rows left in the table: ${leftover}`);

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
