/**
 * Verify the fair-share batch size:
 *
 *     share(d) = min(WORK_QUOTA, ceil(openTotal(d) / enumeratorsIn(d)))
 *
 * The two cases that motivated it:
 *
 *   A. Big district, ONE enumerator (30 000 / 1) -> 5000 now, not all 30 000, and
 *      the next 5000 only after the first batch is completed.
 *   B. Small district, SEVERAL enumerators (1980 / 2) -> 990 each, not 1980 to
 *      whoever synced first. This is what a flat 5000 cap got wrong: 1980 is under
 *      5000, so nothing stopped the first claimer taking the lot.
 *
 * Case A needs a district with >5000 open records. The real data has none, so it is
 * built from a temporary district and synthetic stakeholders, then removed. Case B
 * runs against the real shared district.
 *
 * Everything created here is deleted in the finally block, and claims made against
 * real records are released.
 *
 *   npx tsx scripts/verify-fair-share.ts
 */
import { prisma } from '../src/config/database';
import {
  claimStakeholders,
  releaseClaims,
  getDistrictShares,
  WORK_QUOTA,
} from '../src/utils/stakeholder-assignment';

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

const SYNTH_DISTRICT = 'ZZ Sharetest';
const SYNTH_OPEN = 12000; // > 2 x WORK_QUOTA, so two full batches plus a remainder

async function main() {
  const createdEnumerators: string[] = [];
  let synthDistrictId: string | null = null;
  const touchedReal = new Set<string>();

  try {
    console.log(`WORK_QUOTA = ${WORK_QUOTA}\n`);

    // ================= CASE A: big district, one enumerator =================
    console.log(`=== A. ${SYNTH_OPEN} open, 1 enumerator ===`);

    const district = await prisma.district.create({
      data: { name: SYNTH_DISTRICT, state: 'Maharashtra' },
      select: { id: true, name: true },
    });
    synthDistrictId = district.id;

    const maxPk = (await prisma.stakeholder.aggregate({ _max: { primaryKeyId: true } }))
      ._max.primaryKeyId ?? 0;

    // createMany in one statement — 12 000 individual inserts would be slow enough
    // to look like a hang.
    await prisma.stakeholder.createMany({
      data: Array.from({ length: SYNTH_OPEN }, (_, i) => ({
        primaryKeyId: maxPk + 1 + i,
        companyNameStandardized: `ZZ Share Probe ${i}`,
        district: SYNTH_DISTRICT,
        state: 'Maharashtra',
        dataSource: 'MANUAL',
        status: 'OPEN' as any,
      })),
    });
    console.log(`  created ${SYNTH_OPEN} synthetic stakeholders in ${SYNTH_DISTRICT}`);

    const solo = await prisma.enumerator.create({
      data: {
        loginId: `zz_share_solo_${Date.now()}`,
        name: 'ZZ Share Solo',
        passwordHash: 'x',
        isActive: true,
        isAdmin: false,
        districts: { create: [{ districtId: district.id }] },
      },
      select: { id: true },
    });
    createdEnumerators.push(solo.id);

    const sharesA = await getDistrictShares(solo.id, [SYNTH_DISTRICT]);
    console.log(`  share = ${sharesA[0]!.share} (openTotal ${sharesA[0]!.openTotal}, enumerators ${sharesA[0]!.enumerators})`);
    check('share is capped at WORK_QUOTA, not the whole district',
      sharesA[0]!.share === WORK_QUOTA, `${sharesA[0]!.share}`);

    const a1 = await claimStakeholders(solo.id, [SYNTH_DISTRICT]);
    console.log(`  batch 1: claimed ${a1.claimed}, held ${a1.held}/${a1.target}, pool ${a1.poolRemaining}`);
    check(`first batch is exactly ${WORK_QUOTA}, not all ${SYNTH_OPEN}`,
      a1.claimed === WORK_QUOTA, `claimed ${a1.claimed}`);
    check('the rest stays in the pool for later',
      a1.poolRemaining === SYNTH_OPEN - WORK_QUOTA, `${a1.poolRemaining}`);
    check('reports itself full at the ceiling', a1.full === true);

    const a2 = await claimStakeholders(solo.id, [SYNTH_DISTRICT]);
    check('a second claim adds nothing while the batch is unfinished',
      a2.claimed === 0, `claimed ${a2.claimed}`);

    // Finish the batch the way the app does, then top up again.
    const mine = await prisma.stakeholder.findMany({
      where: { assignedToId: solo.id }, select: { id: true }, take: WORK_QUOTA,
    });
    await prisma.stakeholder.updateMany({
      where: { id: { in: mine.map(m => m.id) } },
      data: { status: 'CLOSED' as any, lockedById: solo.id, lockedAt: new Date() },
    });
    console.log(`  completed batch 1 (${mine.length} closed)`);

    const a3 = await claimStakeholders(solo.id, [SYNTH_DISTRICT]);
    console.log(`  batch 2: claimed ${a3.claimed}, held ${a3.held}/${a3.target}, pool ${a3.poolRemaining}`);
    check('completing the batch releases room and the next batch arrives',
      a3.claimed === WORK_QUOTA, `claimed ${a3.claimed}`);
    check('the second batch is a different set (nothing re-handed)',
      a3.held === WORK_QUOTA, `held ${a3.held} OPEN`);

    // The share shrinks as the district's OPEN total falls — 7000 open now, so
    // ceil(7000/1) is still above the ceiling and the batch stays 5000.
    const sharesAfter = await getDistrictShares(solo.id, [SYNTH_DISTRICT]);
    check('share recomputes from the CURRENT open total',
      sharesAfter[0]!.openTotal === SYNTH_OPEN - WORK_QUOTA,
      `openTotal ${sharesAfter[0]!.openTotal}`);

    // ================= CASE B: small district, two enumerators =============
    console.log('\n=== B. small real district, several enumerators ===');

    const assignments = await prisma.enumeratorDistrict.findMany({
      where: { enumerator: { isActive: true, isAdmin: false } },
      select: {
        enumeratorId: true,
        enumerator: { select: { loginId: true } },
        district: { select: { name: true } },
      },
    });
    const byDistrict = new Map<string, { id: string; loginId: string }[]>();
    for (const a of assignments) {
      const n = a.district?.name;
      if (!n || n === SYNTH_DISTRICT) continue;
      const l = byDistrict.get(n) ?? [];
      l.push({ id: a.enumeratorId, loginId: a.enumerator.loginId });
      byDistrict.set(n, l);
    }
    const shared = [...byDistrict.entries()].find(([, m]) => m.length > 1);

    if (!shared) {
      console.log('  (no real district has two enumerators — skipping case B)');
    } else {
      const [realDistrict, members] = shared;
      const [p, q] = members as [{ id: string; loginId: string }, { id: string; loginId: string }];
      await releaseClaims(p.id);
      await releaseClaims(q.id);

      const sh = await getDistrictShares(p.id, [realDistrict]);
      const s0 = sh[0]!;
      const expected = Math.min(WORK_QUOTA, Math.ceil(s0.openTotal / s0.enumerators));
      console.log(`  ${realDistrict}: ${s0.openTotal} open / ${s0.enumerators} enumerators -> share ${s0.share}`);

      check('share is the equal split, not the whole district',
        s0.share === expected && s0.share < s0.openTotal,
        `share ${s0.share}, openTotal ${s0.openTotal}`);

      const b1 = await claimStakeholders(p.id, [realDistrict]);
      (await prisma.stakeholder.findMany({ where: { assignedToId: p.id }, select: { id: true } }))
        .forEach(r => touchedReal.add(r.id));
      console.log(`  ${p.loginId} claimed ${b1.claimed}`);

      check('the first claimer gets only its share, NOT the whole district',
        b1.claimed === expected, `claimed ${b1.claimed}, expected ${expected}`);
      check('work is left for the colleague',
        b1.poolRemaining > 0, `pool ${b1.poolRemaining}`);

      const b2 = await claimStakeholders(q.id, [realDistrict]);
      (await prisma.stakeholder.findMany({ where: { assignedToId: q.id }, select: { id: true } }))
        .forEach(r => touchedReal.add(r.id));
      console.log(`  ${q.loginId} claimed ${b2.claimed}`);

      check('the second enumerator gets a comparable share',
        Math.abs(b2.claimed - expected) <= 1, `claimed ${b2.claimed}, expected ~${expected}`);

      const pIds = new Set((await prisma.stakeholder.findMany({
        where: { assignedToId: p.id }, select: { id: true },
      })).map(r => r.id));
      const qIds = (await prisma.stakeholder.findMany({
        where: { assignedToId: q.id }, select: { id: true },
      })).map(r => r.id);
      check('the two queues are disjoint',
        !qIds.some(id => pIds.has(id)));
      check('together they cover the district with none left over',
        pIds.size + qIds.length === s0.openTotal,
        `${pIds.size} + ${qIds.length} vs ${s0.openTotal} open`);
    }

    // ================= the formula itself ==================================
    console.log('\n=== the formula, spot-checked ===');
    const cases: [number, number, number][] = [
      [30000, 1, 5000],
      [30000, 3, 5000],
      [1980, 2, 990],
      [100, 5, 20],
      [7, 2, 4],      // ceil(3.5) — a remainder must round UP or a row is orphaned
      [0, 3, 0],
    ];
    for (const [openTotal, enums, want] of cases) {
      const got = Math.min(WORK_QUOTA, Math.ceil(openTotal / Math.max(1, enums)));
      check(`${openTotal} open / ${enums} enum -> ${want}`, got === want, `got ${got}`);
    }
  } finally {
    console.log('\n=== cleanup ===');

    const releasedReal = await prisma.stakeholder.updateMany({
      where: { id: { in: [...touchedReal] } },
      data: { assignedToId: null, assignedAt: null, status: 'OPEN' as any, lockedById: null, lockedAt: null },
    });
    console.log(`  released ${releasedReal.count} claim(s) on real records`);

    const delSynth = await prisma.stakeholder.deleteMany({ where: { district: SYNTH_DISTRICT } });
    console.log(`  deleted ${delSynth.count} synthetic stakeholder(s)`);

    for (const id of createdEnumerators) {
      await prisma.enumeratorDistrict.deleteMany({ where: { enumeratorId: id } });
      await prisma.enumerator.deleteMany({ where: { id } });
    }
    console.log(`  removed ${createdEnumerators.length} probe enumerator(s)`);

    if (synthDistrictId) {
      await prisma.district.deleteMany({ where: { id: synthDistrictId } });
      console.log('  removed the synthetic district');
    }

    const leftSynth = await prisma.stakeholder.count({ where: { district: SYNTH_DISTRICT } });
    const leftAssigned = await prisma.stakeholder.count({ where: { assignedToId: { not: null } } });
    console.log(`  synthetic rows left: ${leftSynth} (expect 0)`);
    console.log(`  assigned rows left in table: ${leftAssigned} (expect 0)`);
    if (leftSynth !== 0 || leftAssigned !== 0) failures++;

    await prisma.$disconnect();
  }

  console.log(`\n=== ${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('\nERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
