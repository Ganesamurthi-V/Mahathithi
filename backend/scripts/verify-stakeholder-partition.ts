/**
 * Prove the stakeholder download partition is correct.
 *
 * The claim being tested is not just "the slices differ" — it is that the slices
 * form a PARTITION of each district: pairwise disjoint AND covering every row, with
 * roughly equal sizes. A scheme that only avoids duplication can still silently
 * orphan records, which is the worse failure: nobody surveys them and nothing
 * reports it.
 *
 * READ-ONLY. Runs the real service methods rather than reimplementing the SQL, so
 * it tests the shipped code path. Private methods are reached through a cast, which
 * is a test seam only — TypeScript's `private` is compile-time.
 *
 *   npx tsx scripts/verify-stakeholder-partition.ts
 */
import { prisma } from '../src/config/database';
import { StakeholderService } from '../src/modules/stakeholder/stakeholder.service';
import { DashboardService } from '../src/modules/dashboard/dashboard.service';
import {
  getDistrictPartitions,
  selectPartitionedPrimaryKeys,
} from '../src/utils/stakeholder-partition';

const svc = new StakeholderService() as any;
const dashboard = new DashboardService();

// The partition helpers moved out of StakeholderService into a shared util so the
// dashboard could use the same logic. Bound here under the old names so the
// existing assertions keep reading the way they did.
svc.getDistrictPartitions = getDistrictPartitions;
svc.selectPartitionedPrimaryKeys = selectPartitionedPrimaryKeys;

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

/** All OPEN primary keys in a district, straight from the table. The ground truth. */
async function allOpenKeys(district: string): Promise<number[]> {
  const rows = await prisma.stakeholder.findMany({
    where: { district, status: 'OPEN' },
    select: { primaryKeyId: true },
    orderBy: { primaryKeyId: 'asc' },
  });
  return rows.map(r => r.primaryKeyId);
}

/** Walk getAssignedPage the way the mobile app does, collecting every key. */
async function downloadAll(
  enumeratorId: string,
  districts: string[],
  pageSize: number,
  isAdmin = false,
): Promise<{ keys: number[]; pages: number }> {
  const keys: number[] = [];
  let cursor = 0;
  let pages = 0;

  for (;;) {
    const page = await svc.getAssignedPage(enumeratorId, districts, cursor, pageSize, undefined, isAdmin);
    pages++;
    for (const s of page.stakeholders) keys.push(s.primaryKeyId);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
    if (pages > 500) throw new Error('pagination did not terminate');
  }
  return { keys, pages };
}

async function main() {
  // ---- find a district that is actually shared -------------------------
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
    const name = a.district?.name;
    if (!name) continue;
    const list = byDistrict.get(name) ?? [];
    list.push({ id: a.enumeratorId, loginId: a.enumerator.loginId });
    byDistrict.set(name, list);
  }

  console.log('=== district membership (active, non-admin) ===');
  for (const [d, m] of byDistrict) {
    console.log(`  ${d.padEnd(20)} n=${m.length}  [${m.map(x => x.loginId).join(', ')}]`);
  }

  const shared = [...byDistrict.entries()].filter(([, m]) => m.length > 1);
  const solo = [...byDistrict.entries()].filter(([, m]) => m.length === 1);

  if (shared.length === 0) {
    console.log('\nNo district has more than one enumerator, so the split cannot be');
    console.log('observed on real data. Aborting rather than reporting a false pass.');
    process.exit(1);
  }

  // ---- the partition property -----------------------------------------
  for (const [district, members] of shared) {
    // Sorted by id, which is exactly how the service assigns k.
    const ordered = members.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    console.log(`\n=== ${district}: n=${ordered.length} ===`);

    const truth = await allOpenKeys(district);
    console.log(`  OPEN stakeholders in district: ${truth.length}`);

    const slices: { loginId: string; index: number; keys: number[] }[] = [];

    for (const m of ordered) {
      const parts = await svc.getDistrictPartitions(m.id, [district], false);
      const p = parts.find((x: any) => x.district === district);
      const keys: number[] = await svc.selectPartitionedPrimaryKeys(
        [p], 0, undefined, Number.MAX_SAFE_INTEGER,
      );
      slices.push({ loginId: m.loginId, index: p.index, keys });
      console.log(`    ${m.loginId.padEnd(16)} k=${p.index}/${p.total}  rows=${keys.length}`);
    }

    // Distinct k per member, or two devices would pull the same slice.
    const indexes = slices.map(s => s.index);
    check('each enumerator gets a distinct slice index',
      new Set(indexes).size === indexes.length, `indexes: ${indexes.join(', ')}`);

    // 1. Pairwise disjoint — the no-duplication requirement.
    let overlapTotal = 0;
    for (let i = 0; i < slices.length; i++) {
      for (let j = i + 1; j < slices.length; j++) {
        const a = new Set(slices[i]!.keys);
        const shared2 = slices[j]!.keys.filter(k => a.has(k));
        overlapTotal += shared2.length;
        if (shared2.length) {
          console.log(`      overlap ${slices[i]!.loginId} vs ${slices[j]!.loginId}: ${shared2.slice(0, 5).join(', ')}`);
        }
      }
    }
    check('slices are pairwise disjoint (no stakeholder downloaded twice)',
      overlapTotal === 0, `${overlapTotal} shared key(s)`);

    // 2. Complete — the no-gaps requirement, which disjointness alone does not give.
    const union = new Set<number>(slices.flatMap(s => s.keys));
    const missing = truth.filter(k => !union.has(k));
    check('every stakeholder in the district belongs to exactly one slice',
      missing.length === 0,
      `${missing.length} orphaned, e.g. ${missing.slice(0, 5).join(', ')}`);
    check('union size equals the district total',
      union.size === truth.length, `union=${union.size} district=${truth.length}`);

    // 3. Roughly equal.
    const sizes = slices.map(s => s.keys.length);
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);
    const spread = truth.length === 0 ? 0 : (max - min) / (truth.length / sizes.length);
    check('slices are within 5% of an equal share',
      spread <= 0.05, `sizes ${sizes.join(' / ')}, spread ${(spread * 100).toFixed(2)}%`);

    // 4. The paginated download returns exactly the slice — small page size on
    //    purpose, so the cursor is exercised over many pages. A partitioned page is
    //    a sparse slice of the id range, which is where an off-by-one in the cursor
    //    would show up as a duplicate or a skipped row.
    const first = ordered[0]!;
    const expected = slices.find(s => s.loginId === first.loginId)!.keys;
    const { keys: paged, pages } = await downloadAll(first.id, [district], 250);
    console.log(`    paged download for ${first.loginId}: ${paged.length} rows over ${pages} page(s)`);

    check('paged download has no duplicates across pages',
      new Set(paged).size === paged.length,
      `${paged.length - new Set(paged).size} duplicate(s)`);
    check('paged download returns exactly the enumerator\'s slice',
      paged.length === expected.length && paged.every((k, i) => k === expected[i]),
      `got ${paged.length}, expected ${expected.length}`);
    check('paged download is ordered by primary key',
      paged.every((k, i) => i === 0 || k > paged[i - 1]!));

    // 5. Two devices downloading concurrently share nothing.
    if (ordered.length > 1) {
      const second = ordered[1]!;
      const other = await downloadAll(second.id, [district], 250);
      const setA = new Set(paged);
      const both = other.keys.filter(k => setA.has(k));
      check('two enumerators paging the same district share zero rows',
        both.length === 0, `${both.length} shared`);
      check('the two downloads together cover the district',
        new Set([...paged, ...other.keys]).size === truth.length,
        `${new Set([...paged, ...other.keys]).size} vs ${truth.length}`);
    }
  }

  // ---- the dashboard must report the slice, not the district ------------
  // This is the number the mobile Overview card shows. Counting the whole district
  // there means an operator works through every row they were given and is left
  // with a figure that never reaches zero.
  for (const [district, members] of shared) {
    const ordered = members.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const truth = await allOpenKeys(district);
    console.log(`\n=== dashboard stats for ${district} ===`);
    console.log(`  district OPEN total: ${truth.length}`);

    let sumOfOpen = 0;
    for (const m of ordered) {
      const stats = await dashboard.getStats(m.id, [district], false);
      const open = stats.stakeholders.open;
      sumOfOpen += open;

      const parts = await svc.getDistrictPartitions(m.id, [district], false);
      const p = parts.find((x: any) => x.district === district);
      const sliceSize: number = (
        await svc.selectPartitionedPrimaryKeys([p], 0, undefined, Number.MAX_SAFE_INTEGER)
      ).length;

      console.log(`    ${m.loginId.padEnd(16)} dashboard open=${open}  slice=${sliceSize}`);
      check(`${m.loginId}: dashboard open equals their slice, not the district`,
        open === sliceSize, `open=${open}, slice=${sliceSize}, district=${truth.length}`);
      check(`${m.loginId}: dashboard open is below the district total`,
        open < truth.length, `open=${open}, district=${truth.length}`);
    }

    // The shares must still add up, or the dashboard would be under-reporting work
    // that nobody is being shown.
    check('the enumerators\' dashboard counts sum to the district total',
      sumOfOpen === truth.length, `sum=${sumOfOpen}, district=${truth.length}`);
  }

  // ---- admin dashboard is unchanged ------------------------------------
  {
    const adminRow = await prisma.enumerator.findFirst({ where: { isAdmin: true }, select: { id: true } });
    const [district] = shared[0]!;
    if (adminRow) {
      const truth = await allOpenKeys(district);
      const stats = await dashboard.getStats(adminRow.id, [district], true);
      console.log(`\n=== admin dashboard on ${district} ===`);
      console.log(`  admin open=${stats.stakeholders.open}, ${district} open=${truth.length}`);

      // getStats sets districtFilter = {} for admins, so the districts argument is
      // ignored and the figure is system-wide. That is pre-existing behaviour and
      // not something the partition changed — the check here is only that an admin
      // is NOT handed a slice, so the number must exceed a single district rather
      // than match it. An earlier version of this assertion expected the district
      // total and failed for that reason.
      check('admin dashboard is not partitioned (still system-wide, not a slice)',
        stats.stakeholders.open > truth.length,
        `open=${stats.stakeholders.open}, single district=${truth.length}`);

      const adminPartitions = await getDistrictPartitions(adminRow.id, [district], true);
      check('admin partition is the identity (total=1, index=0)',
        adminPartitions.every(p => p.total === 1 && p.index === 0),
        JSON.stringify(adminPartitions));
    }
  }

  // ---- unchanged behaviour where nothing is shared ----------------------
  if (solo.length > 0) {
    const [district, members] = solo[0]!;
    const m = members[0]!;
    console.log(`\n=== ${district}: single enumerator (${m.loginId}) ===`);
    const truth = await allOpenKeys(district);
    const parts = await svc.getDistrictPartitions(m.id, [district], false);
    check('n=1 and k=0, so the modulo matches every row',
      parts[0].total === 1 && parts[0].index === 0,
      JSON.stringify(parts[0]));
    const { keys } = await downloadAll(m.id, [district], 2000);
    check('a single-enumerator district still downloads in full (unchanged)',
      keys.length === truth.length, `got ${keys.length}, district has ${truth.length}`);
  }

  // ---- admins are not partitioned --------------------------------------
  const admin = await prisma.enumerator.findFirst({ where: { isAdmin: true }, select: { id: true, loginId: true } });
  if (admin) {
    const [district] = shared[0]!;
    console.log(`\n=== admin (${admin.loginId}) on ${district} ===`);
    const parts = await svc.getDistrictPartitions(admin.id, [district], true);
    check('admin is never given a partial slice',
      parts[0].total === 1 && parts[0].index === 0, JSON.stringify(parts[0]));
    const truth = await allOpenKeys(district);
    const { keys } = await downloadAll(admin.id, [district], 2000, true);
    check('admin downloads the whole district',
      keys.length === truth.length, `got ${keys.length}, district has ${truth.length}`);
  }

  // ---- inactive accounts must not hold a slice -------------------------
  console.log('\n=== inactive accounts ===');
  const inactive = await prisma.enumeratorDistrict.findMany({
    where: { enumerator: { isActive: false } },
    select: { enumeratorId: true, district: { select: { name: true } } },
  });
  if (inactive.length === 0) {
    console.log('  (no inactive enumerator currently holds a district assignment)');
  }
  // Whether or not one exists right now, confirm the divisor ignores them: an
  // inactive holder would reserve a share no device ever downloads.
  let inactiveCounted = false;
  for (const row of inactive) {
    const name = row.district?.name;
    if (!name) continue;
    const activeMembers = byDistrict.get(name) ?? [];
    const parts = await svc.getDistrictPartitions(activeMembers[0]?.id ?? row.enumeratorId, [name], false);
    const p = parts.find((x: any) => x.district === name);
    if (p && p.total > Math.max(activeMembers.length, 1)) inactiveCounted = true;
  }
  check('inactive enumerators are excluded from the divisor', !inactiveCounted);

  console.log(`\n=== ${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`} ===`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('\nERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
