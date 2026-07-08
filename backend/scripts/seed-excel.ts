/**
 * seed-excel.ts — Legacy seeder for Final_Mahaathithi Excel file.
 *
 * NOTE: For new imports prefer the fully-featured `import-excel.ts` script.
 *       This file is kept for backward-compatibility but has been patched
 *       to fix the critical data-quality bugs found in the original version.
 *
 * Bugs fixed:
 *  1. FILE PATH: Now resolves "Final_Mahaathithi (1).xlsx" (falls back to
 *     "Final_Mahaathithi.xlsx") — the original hard-coded the old filename.
 *  2. PIN_Code = 0 bug: Excel stores missing pincodes as the number 0.
 *     `String(0)` → "0" which is not a real pincode → now stored as null.
 *     55,115 rows were affected by this bug.
 *  3. PIN_Code float artefact: "412806.0" → "412806" (not "412806.0").
 *  4. NIC_Code: same numeric-to-string conversion applied.
 *  5. GST_Number: values starting with "Derivable from CIN" are set to null.
 *  6. District: uppercased for consistent matching with the districts table.
 *  7. status: required field now explicitly set to 'OPEN'.
 */

import xlsx from 'xlsx';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Auto-detect the Excel file — support both filename variants
const CANDIDATE_PATHS = [
  path.resolve(__dirname, '../../Final_Mahaathithi (1).xlsx'),
  path.resolve(__dirname, '../../Final_Mahaathithi.xlsx'),
];
const FILE_PATH = CANDIDATE_PATHS.find(p => fs.existsSync(p));

if (!FILE_PATH) {
  console.error('❌ Excel file not found. Expected one of:');
  CANDIDATE_PATHS.forEach(p => console.error('   ', p));
  process.exit(1);
}

// Batch size to prevent memory limit errors or Supabase connection timeouts
const BATCH_SIZE = 2000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert any value to a clean string, returning null for empty/nan/null. */
function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'nan') return null;
  return s;
}

/**
 * Clean a PIN_Code value.
 * - Excel stores pincodes as numbers (e.g. 410501)
 * - 0 / negative values → null  (55,115 rows in this dataset)
 * - Float artefacts stripped: 412806.0 → "412806"
 * - Validates 6-digit Indian pincode range [100000, 999999]
 */
function cleanPin(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let num: number;
  if (typeof v === 'number') {
    num = Math.round(v);
  } else {
    const s = String(v).trim().replace(/\.0+$/, '').replace(/[^0-9].*$/, '').trim();
    if (!s) return null;
    num = parseInt(s, 10);
  }
  if (isNaN(num) || num <= 0) return null;
  if (num < 100000 || num > 999999) return null;
  return String(num).padStart(6, '0');
}

/** Convert numeric NIC code to string. */
function cleanNic(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    const n = Math.round(v);
    return n <= 0 ? null : String(n);
  }
  const s = String(v).trim().replace(/\.0+$/, '');
  return s || null;
}

/** Strip non-GST values like "Derivable from CIN …". */
function cleanGst(v: unknown): string | null {
  const s = toStr(v);
  if (!s) return null;
  if (s.toLowerCase().startsWith('derivable')) return null;
  return s;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Loading Excel file: ${FILE_PATH}`);
  console.log('This might take 30–60 seconds for large files...');

  const workbook = xlsx.readFile(FILE_PATH as string);
  const sheetName = workbook.SheetNames[0];
  console.log(`Sheet: "${sheetName}"`);
  const worksheet = workbook.Sheets[sheetName];

  console.log('Converting sheet to JSON...');
  // defval: null ensures empty cells are parsed as null rather than missing completely
  const rows = xlsx.utils.sheet_to_json(worksheet, { defval: null }) as Record<string, unknown>[];

  console.log(`Successfully parsed ${rows.length.toLocaleString()} rows. Starting database insertion...`);

  let nullPins = 0, zeroPins = 0;

  // Insert in chunks
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);

    const mappedData = chunk.map((row) => {
      // Track PIN quality
      const rawPin = row['PIN_Code'];
      if (rawPin === null || rawPin === undefined) nullPins++;
      else if (rawPin === 0 || rawPin === '0') zeroPins++;

      const district = toStr(row['District']);

      return {
        primaryKeyId:            Math.round(Number(row['Primary_Key_ID'])),
        uin:                     toStr(row['UIN']),
        dataSource:              toStr(row['Data_Source']),
        cinNumber:               toStr(row['CIN_Number']),
        gstNumber:               cleanGst(row['GST_Number']),     // FIX: strip "Derivable…"
        tinNumber:               toStr(row['TIN_Number']),
        companyNameStandardized: toStr(row['Company_Name_Standardized']),
        companyNameOriginal:     toStr(row['Company_Name_Original']),
        fullAddressRaw:          toStr(row['Full_Address_Raw']),
        addressLine1:            toStr(row['Address_Line_1']),
        addressLine2:            toStr(row['Address_Line_2']),
        city:                    toStr(row['City']),
        district:                district ? district.toUpperCase() : null,  // FIX: uppercase
        state:                   toStr(row['State']),
        pinCode:                 cleanPin(row['PIN_Code']),        // FIX: 0 → null
        nicCode:                 cleanNic(row['NIC_Code']),        // FIX: numeric → string
        nicDescription:          toStr(row['NIC_Description']),
        category:                toStr(row['Category']),
        priorityWeight:          row['Priority'] != null ? Number(row['Priority']) : null,
        status:                  'OPEN' as const,                  // FIX: required field
      };
    });

    // Use createMany to insert in bulk
    await prisma.stakeholder.createMany({
      data: mappedData,
      // skipDuplicates is helpful if the script fails midway and you need to restart it
      skipDuplicates: true,
    });

    console.log(`Seeded ${Math.min(i + BATCH_SIZE, rows.length).toLocaleString()} / ${rows.length.toLocaleString()} records...`);
  }

  console.log('✅ Seeding complete! All data has been successfully added to Supabase.');
  console.log(`   PIN_Code null rows:  ${nullPins.toLocaleString()} → stored as null`);
  console.log(`   PIN_Code zero rows:  ${zeroPins.toLocaleString()} → stored as null (was '0' bug)`);
}

main()
  .catch((e) => {
    console.error('An error occurred during seeding:');
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
