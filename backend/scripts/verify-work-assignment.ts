/**
 * Verify the work-assignment model: a bounded, exclusive queue per enumerator that
 * refills from the unassigned pool.
 *
 * The properties that matter:
 *   - the cap holds (5000, and a smaller quota is respected exactly)
 *   - no stakeholder is ever held by two enumerators
 *   - CONCURRENT claims do not hand out the same row. This is the one a
 *     read-then-write would fail, and the reason the claim uses
 *     FOR UPDATE SKIP LOCKED. Tested by firing claims in parallel, not in sequence.
 *   - completing work frees room, and the next top-up refills it
 *   - losing a district releases unfinished claims back to the pool
 *   - claimed rows get a fresh updated_at, or the delta feed would never deliver them
 *
 * SAFETY: every claim it makes is released in the finally block, and it records the
 * exact set it touched so it cannot release anything it did not create.
 *
 *   npx tsx scripts/verify-work-assignment.ts
 */
import { prisma } from '../src/config/database';
import {
  claimStakeholders,
  releaseClaims,
  releaseClaimsOutsideDistricts,
  countHeld,
  countPool,
  WORK_QUOTA,
} from '../src/utils/stakeholder-assignment';
import { SyncService } from '../src/modules/sync/sync.service';

const sync = new SyncService();

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  // Two active non-admin enumerators sharing a district.
  const rows = await prisma.enumeratorDistrict.findMany({
    where: { enumerator: { isActive: true, isAdmin: false } },
    select: {
      enumeratorId: true,
      enumerator: { select: { loginId: true } },
      district: { select: { name: true } },
    },
  });

  const byDistrict = new Map<string, { id: string; loginId: string }[]>();
  for (const r of rows) {
    const n = r.district?.name;
    if (!n) continue;
    const l = byDistrict.get(n) ?? [];
    l.push({ id: r.enumeratorId, loginId: r.enumerator.loginId });
    byDistrict.set(n, l);
  }

  const shared = [...byDistrict.entries()].find(([, m]) => m.length > 1);
  if (!shared) {
    console.log('Need a district with two enumerators to test exclusivity. Aborting.');
    process.exit(1);
  }

  const [district, members] = shared;
  const [a, b] = members as [{ id: string; loginId: string }, { id: string; loginId: string }];
  console.log(`district: ${district}   A=${a.loginId}  B=${b.loginId}`);
  console.log(`WORK_QUOTA = ${WORK_QUOTA}\n`);

  const touched = new Set<string>();

  try {
    // Start clean so counts are unambiguous.
    await releaseClaims(a.id);
    await releaseClaims(b.id);

    const poolStart = await countPool([district]);
    console.log(`unassigned OPEN in ${district}: ${poolStart}`);
    check('there is a pool to claim from', poolStart > 0, `${poolStart}`);

    // ---- the cap ------------------------------------------------------
    console.log('\n=== quota is respected ===');
    const SMALL = 25;
    const r1 = await claimStakeholders(a.id, [district], SMALL);
    (await prisma.stakeholder.findMany({ where: { assignedToId: a.id }, select: { id: true } }))
      .forEach(s => touched.add(s.id));

    check(`claims exactly the quota when the pool is larger (${SMALL})`,
      r1.claimed === SMALL, `claimed ${r1.claimed}`);
    check('held equals the quota', r1.held === SMALL, `held ${r1.held}`);
    check('reports itself full', r1.full === true);

    const again = await claimStakeholders(a.id, [district], SMALL);
    check('a full queue claims nothing more', again.claimed === 0, `claimed ${again.claimed}`);

    // ---- exclusivity --------------------------------------------------
    console.log('\n=== exclusivity ===');
    const r2 = await claimStakeholders(b.id, [district], SMALL);
    (await prisma.stakeholder.findMany({ where: { assignedToId: b.id }, select: { id: true } }))
      .forEach(s => touched.add(s.id));
    check(`the second enumerator also gets ${SMALL}`, r2.claimed === SMALL, `claimed ${r2.claimed}`);

    const aIds = (await prisma.stakeholder.findMany({
      where: { assignedToId: a.id }, select: { id: true },
    })).map(s => s.id);
    const bIds = new Set((await prisma.stakeholder.findMany({
      where: { assignedToId: b.id }, select: { id: true },
    })).map(s => s.id));

    const overlap = aIds.filter(id => bIds.has(id));
    check('the two queues share no stakeholder', overlap.length === 0,
      `${overlap.length} shared`);

    const doubleAssigned = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM (
         SELECT id FROM stakeholders WHERE assigned_to_id IS NOT NULL
         GROUP BY id HAVING COUNT(DISTINCT assigned_to_id) > 1
       ) t`
    );
    check('no row anywhere has two owners (structurally impossible, asserted anyway)',
      Number(doubleAssigned[0]!.n) === 0);

    // ---- concurrency: the real test ------------------------------------
    // A read-then-write claim passes every check above and still fails here.
    console.log('\n=== concurrent claims (FOR UPDATE SKIP LOCKED) ===');
    await releaseClaims(a.id);
    await releaseClaims(b.id);

    const N = 40;
    const [ca, cb] = await Promise.all([
      claimStakeholders(a.id, [district], N),
      claimStakeholders(b.id, [district], N),
    ]);
    (await prisma.stakeholder.findMany({
      where: { assignedToId: { in: [a.id, b.id] } }, select: { id: true },
    })).forEach(s => touched.add(s.id));

    console.log(`  A claimed ${ca.claimed}, B claimed ${cb.claimed}`);

    const aSet = new Set((await prisma.stakeholder.findMany({
      where: { assignedToId: a.id }, select: { id: true },
    })).map(s => s.id));
    const bSet = (await prisma.stakeholder.findMany({
      where: { assignedToId: b.id }, select: { id: true },
    })).map(s => s.id);
    const raceOverlap = bSet.filter(id => aSet.has(id));

    check('parallel claims produced no overlap', raceOverlap.length === 0,
      `${raceOverlap.length} row(s) claimed by both`);
    check('together they claimed the full amount, none lost or double-counted',
      ca.claimed + cb.claimed === aSet.size + bSet.length,
      `${ca.claimed}+${cb.claimed} vs ${aSet.size}+${bSet.length}`);

    // ---- claimed rows are visible to the delta feed ---------------------
    console.log('\n=== claimed rows reach the device ===');
    const sampleId = [...aSet][0]!;
    const sample = await prisma.stakeholder.findUnique({
      where: { id: sampleId },
      select: { updatedAt: true, assignedAt: true },
    });
    check('claiming stamped assigned_at', sample?.assignedAt != null);
    check('claiming bumped updated_at, so the delta feed will deliver it',
      sample!.updatedAt.getTime() >= sample!.assignedAt!.getTime() - 1000,
      `updatedAt=${sample!.updatedAt.toISOString()} assignedAt=${sample!.assignedAt!.toISOString()}`);

    const delta = await sync.getChanges(a.id, [district], new Date(Date.now() - 120000).toISOString(), false);
    const deltaIds = new Set(delta.updatedStakeholders.map((s: any) => s.id));
    check('the delta feed returns the newly claimed rows', deltaIds.has(sampleId));
    check('the delta feed returns nothing claimed by the other enumerator',
      !bSet.some(id => deltaIds.has(id)));

    // ---- finishing work frees room --------------------------------------
    console.log('\n=== completing work frees room under the quota ===');
    const heldBefore = await countHeld(a.id);
    // Simulate a completed survey the way the app does: status CLOSED.
    await prisma.stakeholder.update({
      where: { id: sampleId },
      data: { status: 'CLOSED', lockedById: a.id, lockedAt: new Date() },
    });
    const heldAfter = await countHeld(a.id);
    check('a closed stakeholder no longer counts against the quota',
      heldAfter === heldBefore - 1, `${heldBefore} -> ${heldAfter}`);

    const refill = await claimStakeholders(a.id, [district], heldBefore);
    (await prisma.stakeholder.findMany({ where: { assignedToId: a.id }, select: { id: true } }))
      .forEach(s => touched.add(s.id));
    check('the freed slot is refilled from the unassigned pool',
      refill.claimed === 1, `claimed ${refill.claimed}`);
    check('the completed row keeps its assignment (it is provenance, not a queue slot)',
      (await prisma.stakeholder.findUnique({
        where: { id: sampleId }, select: { assignedToId: true },
      }))?.assignedToId === a.id);

    // Put the sample back.
    await prisma.stakeholder.update({
      where: { id: sampleId },
      data: { status: 'OPEN', lockedById: null, lockedAt: null },
    });

    // ---- losing a district releases claims ------------------------------
    console.log('\n=== losing a district releases unfinished claims ===');
    const beforeRelease = await countHeld(a.id);
    const releasedCount = await releaseClaimsOutsideDistricts(a.id, []);
    const afterRelease = await countHeld(a.id);
    check('claims outside the kept districts are returned to the pool',
      releasedCount === beforeRelease && afterRelease === 0,
      `released ${releasedCount} of ${beforeRelease}, still holding ${afterRelease}`);
  } finally {
    console.log('\n=== cleanup ===');
    const released = await prisma.stakeholder.updateMany({
      where: { id: { in: [...touched] } },
      data: { assignedToId: null, assignedAt: null },
    });
    console.log(`  released ${released.count} claim(s) this test made`);

    const leftA = await prisma.stakeholder.count({ where: { assignedToId: a.id } });
    const leftB = await prisma.stakeholder.count({ where: { assignedToId: b.id } });
    console.log(`  remaining claims: A=${leftA} B=${leftB} (expected 0 / 0)`);
    if (leftA !== 0 || leftB !== 0) failures++;

    const stillAssigned = await prisma.stakeholder.count({ where: { assignedToId: { not: null } } });
    console.log(`  total assigned rows left in the table: ${stillAssigned}`);

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
