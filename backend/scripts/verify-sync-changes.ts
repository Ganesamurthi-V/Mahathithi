/**
 * Verify the /sync/changes delta feed, which is what makes admin edits appear on a
 * device without a full re-sync.
 *
 * The two properties that matter, and why:
 *
 *   FULL ROWS — stakeholderDao.upsertMany on the device is an INSERT OR REPLACE.
 *   If the feed returned a partial row, applying it would BLANK every column it
 *   omitted: the business name, the address, the category. The old feed returned
 *   six columns, which is precisely why no client ever applied it.
 *
 *   PARTITIONED — a shared district is divided between its enumerators. A
 *   district-wide delta would push another enumerator's stakeholders onto this
 *   device, undoing the uniqueness guarantee through the back door.
 *
 * READ-ONLY apart from one field it edits and restores on a stakeholder it picks
 * from the caller's own slice, to prove an edit actually propagates.
 *
 *   npx tsx scripts/verify-sync-changes.ts
 */
import { prisma } from '../src/config/database';
import { SyncService } from '../src/modules/sync/sync.service';
import {
  getDistrictPartitions,
  selectPartitionedPrimaryKeys,
} from '../src/utils/stakeholder-partition';

const sync = new SyncService();

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

// The columns the mobile mirror persists. If the feed omits any of these,
// upsertMany would write NULL over real data.
const MIRROR_COLUMNS = [
  'id', 'primaryKeyId', 'uin', 'dataSource', 'cinNumber', 'gstNumber', 'tinNumber',
  'companyNameStandardized', 'companyNameOriginal', 'fullAddressRaw',
  'addressLine1', 'addressLine2', 'city', 'taluka', 'village', 'district', 'state',
  'pinCode', 'nicCode', 'nicDescription', 'category', 'priorityWeight',
  'companyClass', 'companyStatus', 'companyCategory', 'authorizedCapital',
  'paidupCapital', 'listingStatus', 'registrationDate', 'latitude', 'longitude',
  'digipin', 'status', 'lockedById', 'lockedAt', 'createdAt', 'updatedAt',
];

async function main() {
  // ---- find a shared district and its two enumerators -------------------
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
    if (!n) continue;
    const l = byDistrict.get(n) ?? [];
    l.push({ id: a.enumeratorId, loginId: a.enumerator.loginId });
    byDistrict.set(n, l);
  }

  const shared = [...byDistrict.entries()].find(([, m]) => m.length > 1);
  if (!shared) {
    console.log('No district has more than one enumerator — cannot test the');
    console.log('partitioned delta on real data. Aborting rather than false-passing.');
    process.exit(1);
  }

  const [district, members] = shared;
  const ordered = members.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const [first, second] = ordered as [{ id: string; loginId: string }, { id: string; loginId: string }];
  console.log(`shared district: ${district} (${ordered.map(m => m.loginId).join(', ')})\n`);

  // ---- pick a stakeholder from FIRST's slice ---------------------------
  const firstParts = await getDistrictPartitions(first.id, [district], false);
  const firstKeys = await selectPartitionedPrimaryKeys(firstParts, 0, undefined, Number.MAX_SAFE_INTEGER);
  const secondParts = await getDistrictPartitions(second.id, [district], false);
  const secondKeys = new Set(
    await selectPartitionedPrimaryKeys(secondParts, 0, undefined, Number.MAX_SAFE_INTEGER)
  );
  check('the two slices are disjoint to begin with',
    !firstKeys.some(k => secondKeys.has(k)));

  const target = await prisma.stakeholder.findFirst({
    where: { primaryKeyId: { in: firstKeys.slice(0, 50) } },
    select: { id: true, primaryKeyId: true, companyNameStandardized: true, city: true, updatedAt: true },
  });
  if (!target) throw new Error('no stakeholder found in the first slice');
  console.log(`target: ${target.companyNameStandardized} (pk ${target.primaryKeyId})`);

  const originalCity = target.city;
  const marker = `ZZ-VERIFY-${Date.now()}`;
  // Cursor set just before the edit so the delta window contains only it.
  const cursor = new Date(Date.now() - 1000).toISOString();

  try {
    // ---- simulate an admin edit ---------------------------------------
    console.log('\n=== an edit made "in the admin panel" ===');
    await prisma.stakeholder.update({
      where: { id: target.id },
      data: { city: marker },
    });

    const forFirst = await sync.getChanges(first.id, [district], cursor, false);
    const ids = forFirst.updatedStakeholders.map((s: any) => s.id);
    check('the edited stakeholder appears in the owning enumerator\'s delta',
      ids.includes(target.id), `${ids.length} row(s) returned`);

    const row: any = forFirst.updatedStakeholders.find((s: any) => s.id === target.id);
    check('the delta carries the NEW value, not the old one',
      row?.city === marker, `city=${JSON.stringify(row?.city)}`);

    // ---- full rows ---------------------------------------------------
    console.log('\n=== full rows (upsertMany would blank anything missing) ===');
    const missing = MIRROR_COLUMNS.filter(c => !(c in (row ?? {})));
    check(`all ${MIRROR_COLUMNS.length} mirrored columns are present`,
      missing.length === 0, `missing: ${missing.join(', ')}`);
    check('the business name is present and non-empty, not blanked',
      typeof row?.companyNameStandardized === 'string' && row.companyNameStandardized.length > 0,
      JSON.stringify(row?.companyNameStandardized));

    // ---- partitioned -------------------------------------------------
    console.log('\n=== partitioned (no cross-enumerator leakage) ===');
    const forSecond = await sync.getChanges(second.id, [district], cursor, false);
    const secondIds = forSecond.updatedStakeholders.map((s: any) => s.id);
    check('the OTHER enumerator does not receive this stakeholder',
      !secondIds.includes(target.id),
      `other enumerator got ${secondIds.length} row(s) including it`);

    // Nothing in either delta may fall outside that enumerator's own slice.
    const firstKeySet = new Set(firstKeys);
    const strayFirst = forFirst.updatedStakeholders
      .filter((s: any) => !firstKeySet.has(s.primaryKeyId));
    check('every row in the delta belongs to the caller\'s slice',
      strayFirst.length === 0, `${strayFirst.length} stray row(s)`);

    const straySecond = forSecond.updatedStakeholders
      .filter((s: any) => !secondKeys.has(s.primaryKeyId));
    check('same for the second enumerator',
      straySecond.length === 0, `${straySecond.length} stray row(s)`);

    // ---- cursor advances ---------------------------------------------
    console.log('\n=== cursor ===');
    const after = await sync.getChanges(first.id, [district], forFirst.syncTimestamp, false);
    check('re-pulling with the returned timestamp yields nothing new',
      !after.updatedStakeholders.some((s: any) => s.id === target.id),
      `${after.updatedStakeholders.length} row(s) still returned`);
    check('syncTimestamp is an ISO string the client can store',
      typeof forFirst.syncTimestamp === 'string' && !isNaN(Date.parse(forFirst.syncTimestamp)),
      String(forFirst.syncTimestamp));

    // ---- admin sees everything ---------------------------------------
    console.log('\n=== admin is not partitioned ===');
    const adminRow = await prisma.enumerator.findFirst({ where: { isAdmin: true }, select: { id: true } });
    if (adminRow) {
      const forAdmin = await sync.getChanges(adminRow.id, [district], cursor, true);
      check('an admin delta includes the stakeholder regardless of slice',
        forAdmin.updatedStakeholders.some((s: any) => s.id === target.id));
    }
  } finally {
    console.log('\n=== restore ===');
    await prisma.stakeholder.update({
      where: { id: target.id },
      data: { city: originalCity },
    });
    const back = await prisma.stakeholder.findUnique({
      where: { id: target.id },
      select: { city: true },
    });
    const ok = back?.city === originalCity;
    console.log(`  city restored to ${JSON.stringify(originalCity)}: ${ok ? 'YES' : 'NO'}`);
    if (!ok) failures++;
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
