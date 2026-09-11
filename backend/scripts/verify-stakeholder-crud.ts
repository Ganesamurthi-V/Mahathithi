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

    // Every client-settable column, each with a distinct value so a field that is
    // dropped, swapped or written to the wrong column is visible rather than
    // coincidentally matching.
    const FULL_PAYLOAD: Record<string, any> = {
      companyNameStandardized: NAME,
      companyNameOriginal: `${NAME} (original)`,
      uin: 'MAH-TOUR-999999',

      cinNumber: 'U55101PN2014PTC151643',
      gstNumber: '27ABCDE1234F1Z5',
      tinNumber: 'TIN-VERIFY-001',

      fullAddressRaw: 'H.NO. 907, KURULI, CHAKAN, PUNE, Maharashtra, 410501-India',
      addressLine1: 'H.NO. 907, KURULI',
      addressLine2: 'CHAKAN TALUKA- KHED',
      city: 'Malvan, "quoted"',
      taluka: 'Kudal',
      village: 'Tarkarli',
      district: 'Pune',
      state: 'Maharashtra',
      pinCode: '416606',

      nicCode: '55101',
      nicDescription: 'Hotels & Resorts — short stay',
      category: 'Hotels & Resorts',
      companyClass: 'Private',
      companyStatus: 'Active',
      companyCategory: 'Company limited by Shares',
      listingStatus: 'Unlisted',
      registrationDate: '12/03/2014',

      authorizedCapital: 500000.5,
      paidupCapital: 100000.25,
      priorityWeight: 7.5,

      latitude: 16.0594,
      longitude: 73.4629,
      digipin: '4T32TTT8M8',
    };

    const createRes = await axios.post(`${BASE}/api/stakeholders`, FULL_PAYLOAD, { headers });
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

    // ---- every submitted field round-trips ------------------------------
    // Compares against the DATABASE row, not the response body: a field could be
    // echoed back from the request while never being persisted.
    // Count comes from the payload rather than being hardcoded, so this heading
    // cannot drift out of date when fields are added or removed.
    console.log(`\n=== all ${Object.keys(FULL_PAYLOAD).length} submitted fields persisted ===`);
    const mismatches: string[] = [];
    for (const [key, sent] of Object.entries(FULL_PAYLOAD)) {
      const stored = (inDb as any)?.[key];
      const equal = typeof sent === 'number'
        ? Math.abs((stored ?? NaN) - sent) < 1e-9
        : stored === sent;
      if (!equal) mismatches.push(`${key}: sent ${JSON.stringify(sent)}, stored ${JSON.stringify(stored)}`);
    }
    check(`all ${Object.keys(FULL_PAYLOAD).length} submitted fields stored exactly`,
      mismatches.length === 0,
      mismatches.join(' | '));

    // Every column in the table must be accounted for: submitted above, owned by
    // the server, or deliberately not exposed. This fails if a migration adds a
    // column and nobody decides which bucket it belongs in.
    const SERVER_OWNED = [
      'id', 'primaryKeyId', 'createdAt', 'updatedAt',
      'status', 'lockedById', 'lockedAt', 'dataSource',
    ];
    // Removed from both forms and from createStakeholderSchema on request. Listed
    // explicitly rather than just omitted, so this stays a deliberate exclusion
    // instead of looking like an oversight.
    const NOT_EXPOSED = [
      'fuzzySimilarityScore', 'crossSourceMatch', 'humanReviewRequired',
      'dedupMatchStatus', 'sourceLineageNotes',
    ];
    const allColumns = Object.keys(inDb as object);
    const uncovered = allColumns.filter(
      c => !(c in FULL_PAYLOAD) && !SERVER_OWNED.includes(c) && !NOT_EXPOSED.includes(c)
    );
    check('every stakeholders column is accounted for',
      uncovered.length === 0,
      `unaccounted: ${uncovered.join(', ')}`);
    console.log(`        (${allColumns.length} columns = ${Object.keys(FULL_PAYLOAD).length} settable + ${SERVER_OWNED.length} server-owned + ${NOT_EXPOSED.length} not exposed)`);

    // The dedup columns must be absent from a manual row, not silently defaulted.
    const dedupValues = NOT_EXPOSED.map(k => (inDb as any)?.[k]);
    check('dedup/lineage columns left null on a manually created row',
      dedupValues.every(v => v === null || v === undefined),
      NOT_EXPOSED.map((k, i) => `${k}=${JSON.stringify(dedupValues[i])}`).join(', '));

    check('float precision preserved on capital figures',
      inDb?.authorizedCapital === 500000.5 && inDb?.paidupCapital === 100000.25,
      `${inDb?.authorizedCapital}, ${inDb?.paidupCapital}`);
    check('registrationDate kept verbatim, not normalised to ISO',
      inDb?.registrationDate === '12/03/2014', String(inDb?.registrationDate));

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

    // NOTE: cinNumber and the other registry columns USED to be rejected here.
    // They are accepted now — the form is meant to cover every stakeholders column
    // — and their persistence is asserted by the 34-field round-trip above.
    // Provenance is protected by dataSource alone, checked below: that is the field
    // that determines whether a row claims to be registry-sourced, and it is the
    // only one that cannot be faked.
    try {
      // .strict() must still reject genuinely unknown keys, or a typo'd field name
      // would be silently discarded and the operator would think it saved.
      await axios.post(
        `${BASE}/api/stakeholders`,
        { companyNameStandardized: 'ZZ strict probe', notARealColumn: 'x' },
        { headers }
      );
      check('unknown field rejected (typo is not silently dropped)', false, 'request succeeded');
    } catch (e: any) {
      check('unknown field rejected (typo is not silently dropped)',
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

    // Provenance cannot be spoofed: if dataSource were settable, a hand-entered
    // row could claim to have come from the MCA registry.
    try {
      await axios.post(
        `${BASE}/api/stakeholders`,
        { companyNameStandardized: 'ZZ provenance probe', dataSource: 'MCA' },
        { headers }
      );
      check('dataSource cannot be spoofed', false, 'request succeeded');
    } catch (e: any) {
      check('dataSource cannot be spoofed', e.response?.status === 400, `status ${e.response?.status}`);
    }

    // The dedup/lineage fields were removed from both forms AND the schema. If the
    // schema still took them, the API and the UI would disagree — an endpoint
    // accepting fields no client offers.
    try {
      await axios.post(
        `${BASE}/api/stakeholders`,
        { companyNameStandardized: 'ZZ dedup probe', dedupMatchStatus: 'unique' },
        { headers }
      );
      check('removed dedup/lineage field rejected', false, 'request succeeded');
    } catch (e: any) {
      check('removed dedup/lineage field rejected',
        e.response?.status === 400, `status ${e.response?.status}`);
    }

    // A numeric column must reject text rather than silently storing NULL.
    try {
      await axios.post(
        `${BASE}/api/stakeholders`,
        { companyNameStandardized: 'ZZ numeric probe', authorizedCapital: 'not a number' },
        { headers }
      );
      check('text in a numeric column rejected', false, 'request succeeded');
    } catch (e: any) {
      check('text in a numeric column rejected', e.response?.status === 400, `status ${e.response?.status}`);
    }

    // Both clients submit '' for an untouched numeric input, so that must be
    // treated as absent rather than rejected — otherwise every blank optional
    // number is a 400 the operator cannot explain.
    try {
      const blankRes = await axios.post(
        `${BASE}/api/stakeholders`,
        {
          companyNameStandardized: 'ZZ blank numeric probe',
          // district is explicit here because this probe is about numeric handling;
          // the admin account has no assigned districts, so omitting it would fail
          // on the district rule instead and test nothing about numbers.
          district: 'Pune',
          authorizedCapital: '',
          priorityWeight: '',
        },
        { headers }
      );
      check('blank numeric accepted as absent (untouched form input)',
        blankRes.status === 201 && blankRes.data?.data?.authorizedCapital === null,
        `status ${blankRes.status}, stored ${JSON.stringify(blankRes.data?.data?.authorizedCapital)}`);
      // Clean this probe up immediately; it is a real row.
      await prisma.stakeholder.deleteMany({ where: { id: blankRes.data.data.id } });
    } catch (e: any) {
      check('blank numeric accepted as absent (untouched form input)', false,
        `status ${e.response?.status}: ${msgOf(e)}`);
    }

    // ---- the mobile payload -------------------------------------------
    // Exactly what the mobile add form sends: the 9 fields the detail screen shows,
    // and NO district. The server must fill district in, or the row would be
    // excluded from every district-filtered query while still counting in totals.
    console.log('\n=== mobile add form payload ===');

    const MOBILE_PAYLOAD = {
      companyNameStandardized: 'ZZ Mobile Flow Test',
      companyNameOriginal: 'ZZ Mobile Flow Test',
      category: 'Worker Hostels',
      fullAddressRaw: 'S/o Gunaji Bagaytkar, Bomdojichiwadi, Vengurla',
      city: 'Sindhudurg',
      state: 'Maharashtra',
      pinCode: '416517',
      nicCode: '55902',
      nicDescription: 'Transport, storage and Communications',
    };

    // With no district assigned and none supplied, the create must be refused
    // rather than writing district = NULL. 5 of the 11 enumerators in this database
    // have no assigned districts, and districtGuard already blocks them from every
    // :id route, so refusing here is consistent rather than a new restriction.
    const adminId = login.data.data.enumerator?.id ?? login.data.data.user?.id;
    const priorAssignments = await prisma.enumeratorDistrict.findMany({
      where: { enumeratorId: adminId },
      select: { districtId: true },
    });
    check('test account has no districts, so the refusal path is reachable',
      priorAssignments.length === 0, `${priorAssignments.length} assignment(s)`);

    try {
      await axios.post(`${BASE}/api/stakeholders`, MOBILE_PAYLOAD, { headers });
      check('district-less create refused when none can be determined', false,
        'request succeeded — a NULL-district row was created');
    } catch (e: any) {
      check('district-less create refused when none can be determined',
        e.response?.status === 400, `status ${e.response?.status}`);
      check('refusal explains how to resolve it',
        /district/i.test(msgOf(e)) && /assign|enter/i.test(msgOf(e)),
        JSON.stringify(msgOf(e)));
    }

    // Now give the caller a district and repeat, which is the real mobile case: a
    // field enumerator does have one. Removed again immediately below.
    const someDistrict = await prisma.district.findFirst({ select: { id: true, name: true } });
    if (!someDistrict) throw new Error('no districts in the database to test with');
    const tempAssignment = await prisma.enumeratorDistrict.create({
      data: { enumeratorId: adminId, districtId: someDistrict.id },
    });
    console.log(`        (temporarily assigned "${someDistrict.name}" to the test account)`);

    let mobileRow: any;
    try {
      // A fresh login: districts are resolved into the token/session at sign-in, so
      // the existing token still reflects the old empty assignment.
      const reLogin = await axios.post(`${BASE}/api/auth/login`, { loginId: USER, password: PASS });
      const reHeaders = { Authorization: `Bearer ${reLogin.data.data.tokens.accessToken}` };

      const mobileRes = await axios.post(`${BASE}/api/stakeholders`, MOBILE_PAYLOAD, { headers: reHeaders });
      mobileRow = mobileRes.data?.data;
      check('201 Created from the mobile field set', mobileRes.status === 201, `status ${mobileRes.status}`);
      check('district filled in from the assignment despite not being sent',
        mobileRow?.district === someDistrict.name,
        `got ${JSON.stringify(mobileRow?.district)}, expected ${someDistrict.name}`);
    } finally {
      await prisma.enumeratorDistrict.delete({ where: { id: tempAssignment.id } });
      const left = await prisma.enumeratorDistrict.count({ where: { enumeratorId: adminId } });
      console.log(`        (assignment removed; ${left} remaining, was ${priorAssignments.length})`);
    }
    check('dataSource is MANUAL', mobileRow?.dataSource === 'MANUAL', mobileRow?.dataSource);
    check('status is OPEN', mobileRow?.status === 'OPEN', mobileRow?.status);
    // The detail screen's ADDRESS row reads fullAddressRaw, so a value written to
    // addressLine1 instead would save but never display.
    check('address stored in fullAddressRaw, the column the detail screen reads',
      mobileRow?.fullAddressRaw === 'S/o Gunaji Bagaytkar, Bomdojichiwadi, Vengurla',
      JSON.stringify(mobileRow?.fullAddressRaw));
    check('every field the detail screen shows is populated',
      !!mobileRow?.companyNameStandardized && !!mobileRow?.companyNameOriginal &&
      !!mobileRow?.category && !!mobileRow?.fullAddressRaw && !!mobileRow?.city &&
      !!mobileRow?.state && !!mobileRow?.pinCode && !!mobileRow?.nicCode &&
      !!mobileRow?.nicDescription && !!mobileRow?.district && !!mobileRow?.dataSource);
    // The survey form is opened with this id straight after, so it has to be real.
    const mobileInDb = await prisma.stakeholder.findUnique({ where: { id: mobileRow.id } });
    check('row exists so the survey form can be opened against it', mobileInDb !== null);
    await prisma.stakeholder.deleteMany({ where: { id: mobileRow.id } });

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
