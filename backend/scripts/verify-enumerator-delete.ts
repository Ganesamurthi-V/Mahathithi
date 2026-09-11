/**
 * End-to-end check of the enumerator hard delete and the password policy.
 *
 * SAFETY
 * Creates its OWN throwaway enumerator and deletes only that one. The refusal path
 * is tested against a real account that has surveys, but that path asserts the
 * delete is REFUSED, so no real account or field work is ever removed. Anything this
 * script creates is cleaned up in the finally block.
 *
 *   npx tsx scripts/verify-enumerator-delete.ts
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

// Must stay identical to PASSWORD_RULES in admin-panel EnumeratorsPage.tsx and to
// validatePassword() in admin.routes.ts. Drift here means the form promises a
// password the server then rejects.
const RULES: { label: string; password: string; shouldPass: boolean }[] = [
  { label: 'valid password accepted',        password: 'Str0ng!Passw0rd', shouldPass: true },
  { label: 'under 10 characters rejected',   password: 'Sh0rt!Aa',        shouldPass: false },
  { label: 'no uppercase rejected',          password: 'l0ngenough!x',    shouldPass: false },
  { label: 'no lowercase rejected',          password: 'L0NGENOUGH!X',    shouldPass: false },
  { label: 'no number rejected',             password: 'LongEnough!xy',   shouldPass: false },
  { label: 'no special character rejected',  password: 'LongEnough123',   shouldPass: false },
];

async function main() {
  const login = await axios.post(`${BASE}/api/auth/login`, { loginId: USER, password: PASS });
  const token = login.data?.data?.tokens?.accessToken;
  if (!token) throw new Error('no token');
  const headers = { Authorization: `Bearer ${token}` };
  const adminId = login.data.data.enumerator?.id ?? login.data.data.user?.id;
  console.log('logged in\n');

  const created: string[] = [];

  try {
    // ---- password policy ------------------------------------------------
    console.log('=== password policy (server matches the form rules) ===');
    for (const r of RULES) {
      const loginId = `zz_pw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      try {
        const res = await axios.post(
          `${BASE}/api/admin/enumerators`,
          { loginId, password: r.password, name: 'ZZ Password Probe' },
          { headers }
        );
        if (res.data?.data?.id) created.push(res.data.data.id);
        check(r.label, r.shouldPass, r.shouldPass ? undefined : 'was accepted but should be rejected');
      } catch (e: any) {
        const is400 = e.response?.status === 400;
        check(r.label, !r.shouldPass && is400, `status ${e.response?.status}: ${msgOf(e)}`);
      }
    }

    // ---- hard delete on a throwaway account -----------------------------
    console.log('\n=== hard delete ===');
    const loginId = `zz_del_${Date.now()}`;
    const mkRes = await axios.post(
      `${BASE}/api/admin/enumerators`,
      { loginId, password: 'Str0ng!Passw0rd', name: 'ZZ Delete Probe', phone: '9999999999' },
      { headers }
    );
    const victimId: string = mkRes.data.data.id;
    created.push(victimId);
    check('throwaway enumerator created', !!victimId);

    // Give it a district so the cascade has something to remove, and so the
    // download partition would have counted it.
    const district = await prisma.district.findFirst({ select: { id: true, name: true } });
    if (!district) throw new Error('no districts to assign');
    await axios.put(
      `${BASE}/api/admin/enumerators/${victimId}/districts`,
      { districtIds: [district.id] },
      { headers }
    );
    const assignedBefore = await prisma.enumeratorDistrict.count({ where: { enumeratorId: victimId } });
    check('district assigned before delete', assignedBefore === 1, `${assignedBefore}`);

    const delRes = await axios.delete(`${BASE}/api/admin/enumerators/${victimId}`, { headers });
    check('200 OK', delRes.status === 200, `status ${delRes.status}`);
    check('response reports a permanent delete',
      /permanently deleted/i.test(delRes.data?.message || ''), delRes.data?.message);

    // The whole point: the row must be GONE, not flipped to inactive.
    const stillThere = await prisma.enumerator.findUnique({ where: { id: victimId } });
    check('enumerator row is deleted, not deactivated', stillThere === null,
      stillThere ? `still present, isActive=${stillThere.isActive}` : undefined);
    if (stillThere === null) created.splice(created.indexOf(victimId), 1);

    const assignedAfter = await prisma.enumeratorDistrict.count({ where: { enumeratorId: victimId } });
    check('district assignments removed', assignedAfter === 0, `${assignedAfter}`);

    const sessionsAfter = await prisma.session.count({ where: { enumeratorId: victimId } });
    check('sessions removed (forces logout)', sessionsAfter === 0, `${sessionsAfter}`);

    // It must also disappear from the list the admin page renders.
    const listRes = await axios.get(`${BASE}/api/admin/enumerators`, { headers });
    const list: any[] = listRes.data?.data ?? [];
    check('gone from GET /admin/enumerators, so the table cannot show it',
      !list.some(e => e.id === victimId));

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'enumerator_deleted', entityId: victimId },
    });
    check('delete is audited', audit !== null);
    const details = audit?.details as any;
    check('audit snapshots the identity, which SetNull is about to erase elsewhere',
      details?.loginId === loginId && details?.name === 'ZZ Delete Probe',
      JSON.stringify(details));

    // ---- refusal when field work exists ---------------------------------
    console.log('\n=== refused when surveys exist ===');
    const withSurvey = await prisma.survey.findFirst({ select: { enumeratorId: true } });
    if (withSurvey) {
      const before = await prisma.enumerator.findUnique({
        where: { id: withSurvey.enumeratorId },
        select: { id: true, loginId: true, isActive: true },
      });
      try {
        await axios.delete(`${BASE}/api/admin/enumerators/${withSurvey.enumeratorId}`, { headers });
        check('delete refused for an enumerator with surveys', false,
          'request SUCCEEDED — field work was destroyed');
      } catch (e: any) {
        check('delete refused for an enumerator with surveys',
          e.response?.status === 409, `status ${e.response?.status}`);
        check('refusal names the attached work and offers Deactivate',
          /survey/i.test(msgOf(e)) && /deactivate/i.test(msgOf(e)), JSON.stringify(msgOf(e)));
      }
      const after = await prisma.enumerator.findUnique({
        where: { id: withSurvey.enumeratorId },
        select: { id: true, isActive: true },
      });
      check('that enumerator still exists and is untouched',
        after !== null && before !== null && after.isActive === before.isActive);
    } else {
      console.log('  (no enumerator has surveys, so the 409 path cannot be exercised)');
    }

    // ---- guards ---------------------------------------------------------
    console.log('\n=== guards ===');
    try {
      await axios.delete(`${BASE}/api/admin/enumerators/${adminId}`, { headers });
      check('cannot delete your own account', false, 'request succeeded');
    } catch (e: any) {
      check('cannot delete your own account', e.response?.status === 400, `status ${e.response?.status}`);
    }

    try {
      await axios.delete(`${BASE}/api/admin/enumerators/00000000-0000-0000-0000-000000000000`, { headers });
      check('unknown id gives 404', false, 'request succeeded');
    } catch (e: any) {
      check('unknown id gives 404', e.response?.status === 404, `status ${e.response?.status}`);
    }

    try {
      await axios.delete(`${BASE}/api/admin/enumerators/${adminId}`);
      check('unauthenticated delete rejected', false, 'request succeeded');
    } catch (e: any) {
      check('unauthenticated delete rejected', e.response?.status === 401, `status ${e.response?.status}`);
    }

    // ---- which existing accounts are now removable ----------------------
    console.log('\n=== existing inactive accounts (read-only) ===');
    const inactive = await prisma.enumerator.findMany({
      where: { isActive: false },
      select: { id: true, loginId: true, name: true },
    });
    for (const e of inactive) {
      const s = await prisma.survey.count({ where: { enumeratorId: e.id } });
      const p = await prisma.phoneValidation.count({ where: { enumeratorId: e.id } });
      const removable = s === 0 && p === 0;
      console.log(`  ${e.loginId.padEnd(14)} surveys=${s} phoneValidations=${p}  ${removable ? 'DELETABLE' : 'blocked'}`);
    }
    console.log('  (nothing deleted here — listed so you know what the trash icon will do)');
  } finally {
    console.log('\n=== cleanup ===');
    for (const id of created) {
      await prisma.enumeratorDistrict.deleteMany({ where: { enumeratorId: id } });
      await prisma.session.deleteMany({ where: { enumeratorId: id } });
      await prisma.enumerator.deleteMany({ where: { id } });
    }
    if (created.length) console.log(`  removed ${created.length} leftover probe account(s)`);

    const strays = await prisma.enumerator.deleteMany({
      where: { loginId: { startsWith: 'zz_' } },
    });
    if (strays.count > 0) console.log(`  removed ${strays.count} stray zz_ account(s)`);

    const audits = await prisma.auditLog.deleteMany({
      where: {
        action: { in: ['enumerator_created', 'enumerator_deleted'] },
        details: { path: ['name'], string_starts_with: 'ZZ ' },
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
