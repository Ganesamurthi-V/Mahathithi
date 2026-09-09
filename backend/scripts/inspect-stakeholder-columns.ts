/**
 * Dump the real stakeholders table shape from the database.
 *
 * Reads information_schema rather than trusting schema.prisma, so drift between
 * the two shows up. information_schema is a small system catalogue, so this is
 * fast even though the table itself has ~295K rows — no full scan involved.
 *
 *   npx tsx scripts/inspect-stakeholder-columns.ts
 */
import { prisma } from '../src/config/database';

type Col = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
};

async function main() {
  const cols = await prisma.$queryRawUnsafe<Col[]>(`
    SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stakeholders'
    ORDER BY ordinal_position
  `);

  console.log(`stakeholders: ${cols.length} columns\n`);
  console.log('  #  column                          type                nullable  default');
  console.log('  -- ------------------------------- ------------------- --------- -------------------');
  cols.forEach((c, i) => {
    const len = c.character_maximum_length ? `(${c.character_maximum_length})` : '';
    console.log(
      `  ${String(i + 1).padStart(2)} ${c.column_name.padEnd(31)} ${(c.data_type + len).padEnd(19)} ${c.is_nullable.padEnd(9)} ${c.column_default ?? ''}`
    );
  });

  // Which of these does the create schema currently accept?
  const ACCEPTED_CAMEL = [
    'companyNameStandardized', 'companyNameOriginal', 'district', 'addressLine1',
    'addressLine2', 'fullAddressRaw', 'city', 'taluka', 'village', 'state',
    'pinCode', 'category', 'gstNumber', 'nicCode', 'nicDescription',
    'latitude', 'longitude', 'digipin',
  ];
  // Must separate a trailing digit too: Prisma maps addressLine1 -> address_line_1,
  // so a naive [A-Z] replace yields address_line1 and reports the column as
  // missing when it is actually mapped.
  const toSnake = (s: string) =>
    s.replace(/[A-Z]/g, m => '_' + m.toLowerCase()).replace(/([a-z])(\d)/g, '$1_$2');
  const accepted = new Set(ACCEPTED_CAMEL.map(toSnake));

  // Columns the server owns and must not take from a client.
  const SERVER_OWNED = new Set([
    'id', 'primary_key_id', 'created_at', 'updated_at',
    'status', 'locked_by_id', 'locked_at', 'data_source',
  ]);

  const missing = cols
    .map(c => c.column_name)
    .filter(n => !accepted.has(n) && !SERVER_OWNED.has(n));

  console.log(`\ncurrently accepted by createStakeholderSchema: ${accepted.size}`);
  console.log(`server-owned (never client-settable):          ${SERVER_OWNED.size}`);
  console.log(`\nNOT yet in the create form (${missing.length}):`);
  missing.forEach(n => {
    const c = cols.find(x => x.column_name === n)!;
    console.log(`  - ${n.padEnd(30)} ${c.data_type}`);
  });

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
