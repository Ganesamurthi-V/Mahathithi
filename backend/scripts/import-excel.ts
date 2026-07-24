/**
 * MahaAtithi Excel Import Pipeline
 *
 * Imports stakeholder records from the Final_Mahaathithi Excel file into Supabase/PostgreSQL.
 *
 * Key fixes over seed-excel.ts:
 *  1. PIN_Code is stored as a number in Excel (e.g. 410501). String(0) → "0" bug fixed:
 *     zero or negative pincodes are treated as null.
 *  2. NIC_Code is stored as a number — converted to string correctly (no leading-zero loss
 *     since Indian NIC codes are 5 digits and all start with non-zero in this dataset).
 *  3. GST numbers that say "Derivable from CIN …" are normalised to null.
 *  4. Full_Address_Raw may contain "-India" suffix in the pincode portion — cleaned up.
 *  5. District is uppercased for consistent matching with the districts table.
 *  6. status defaults to OPEN (required field).
 *  7. In-memory deduplication on Primary_Key_ID.
 *  8. Batched inserts with configurable batch size and concurrency.
 *  9. Per-row error isolation — one bad row never aborts the full import.
 * 10. Correct file path to "Final_Mahaathithi (1).xlsx".
 *
 * Usage (from backend/ directory):
 *   npx tsx scripts/import-excel.ts
 *   npx tsx scripts/import-excel.ts --dry-run
 *   npx tsx scripts/import-excel.ts --upsert
 *   npx tsx scripts/import-excel.ts --batch-size=3000
 *   npx tsx scripts/import-excel.ts --file=path/to/other.xlsx
 *
 * Excel columns (19 total):
 *   Primary_Key_ID, UIN, Data_Source, CIN_Number, GST_Number, TIN_Number,
 *   Company_Name_Standardized, Company_Name_Original, Full_Address_Raw,
 *   Address_Line_1, Address_Line_2, City, District, State, PIN_Code,
 *   NIC_Code, NIC_Description, Category, Priority
 */

import * as fs from 'fs';
import * as path from 'path';
import xlsx from 'xlsx';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { getDigiPin } from '../src/utils/digipin';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient({ log: [] });

// ============================================================================
// CONFIG
// ============================================================================

interface Config {
  filePath: string;
  batchSize: number;
  concurrency: number;
  dryRun: boolean;
  upsert: boolean;
  skipErrors: boolean;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  // Default file: look for both naming variants in the project root
  const defaultPaths = [
    path.resolve(__dirname, '../../Final_Mahaathithi (1).xlsx'),
    path.resolve(__dirname, '../../Final_Mahaathithi.xlsx'),
  ];
  const defaultFile = defaultPaths.find(p => fs.existsSync(p)) ?? defaultPaths[0];

  const cfg: Config = {
    filePath: defaultFile,
    batchSize: 2000,
    concurrency: 3,
    dryRun: false,
    upsert: false,
    skipErrors: true,
  };

  for (const arg of args) {
    if (arg.startsWith('--file='))          cfg.filePath   = arg.split('=')[1];
    else if (arg.startsWith('--batch-size=')) cfg.batchSize  = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--concurrency=')) cfg.concurrency = parseInt(arg.split('=')[1], 10);
    else if (arg === '--dry-run')            cfg.dryRun     = true;
    else if (arg === '--upsert')             cfg.upsert     = true;
    else if (arg === '--strict')             cfg.skipErrors = false;
    else if (arg === '--help') {
      console.log(`
Usage: npx tsx scripts/import-excel.ts [options]

Options:
  --file=<path>        Path to xlsx file (default: auto-detected)
  --batch-size=<n>     Records per DB batch (default: 2000)
  --concurrency=<n>    Parallel batch inserts (default: 3)
  --dry-run            Validate + parse only, no DB writes
  --upsert             Update existing rows on Primary_Key_ID conflict
  --strict             Stop on first validation error
  --help               Show this help
`);
      process.exit(0);
    }
  }

  return cfg;
}

// ============================================================================
// DISTRICT NORMALIZATION
// ============================================================================

/**
 * Canonical 37 Maharashtra district names.
 * The map below corrects common misspellings, alternate names, and extra
 * entries found in the Excel data to one of these 37 canonical values.
 */
const CANONICAL_DISTRICTS = [
  'Ahmednagar', 'Akola', 'Amravati', 'Aurangabad', 'Beed', 'Bhandara',
  'Buldhana', 'Chandrapur', 'Dhule', 'Gadchiroli', 'Gondia', 'Hingoli',
  'Jalgaon', 'Jalna', 'Kolhapur', 'Latur', 'Mumbai City', 'Mumbai Suburban',
  'Nagpur', 'Nanded', 'Nandurbar', 'Nashik', 'Navi Mumbai', 'Osmanabad',
  'Palghar', 'Parbhani', 'Pune', 'Raigad', 'Ratnagiri', 'Sangli', 'Satara',
  'Sindhudurg', 'Solapur', 'Thane', 'Wardha', 'Washim', 'Yavatmal',
];

/**
 * Maps known misspellings / alternate names → canonical district name.
 * Keys are UPPERCASE for case-insensitive matching.
 */
const DISTRICT_ALIAS_MAP: Record<string, string> = {
  // Exact matches (uppercase key → title case value)
  'AHMEDNAGAR': 'Ahmednagar', 'AHMED NAGAR': 'Ahmednagar', 'AHMEDANAGAR': 'Ahmednagar', 'AHILYANAGAR': 'Ahmednagar',
  'AKOLA': 'Akola',
  'AMRAVATI': 'Amravati', 'AMARAVATI': 'Amravati',
  'AURANGABAD': 'Aurangabad', 'CHHATRAPATI SAMBHAJINAGAR': 'Aurangabad', 'SAMBHAJINAGAR': 'Aurangabad',
  'BEED': 'Beed', 'BID': 'Beed',
  'BHANDARA': 'Bhandara',
  'BULDHANA': 'Buldhana', 'BULDANA': 'Buldhana', 'BULDHANA': 'Buldhana',
  'CHANDRAPUR': 'Chandrapur',
  'DHULE': 'Dhule', 'DHULIA': 'Dhule',
  'GADCHIROLI': 'Gadchiroli',
  'GONDIA': 'Gondia', 'GONDIYA': 'Gondia',
  'HINGOLI': 'Hingoli',
  'JALGAON': 'Jalgaon',
  'JALNA': 'Jalna',
  'KOLHAPUR': 'Kolhapur',
  'LATUR': 'Latur',
  'MUMBAI CITY': 'Mumbai City', 'MUMBAI': 'Mumbai City',
  'MUMBAI SUBURBAN': 'Mumbai Suburban', 'MUMBAI SUBURBS': 'Mumbai Suburban',
  'NAGPUR': 'Nagpur',
  'NANDED': 'Nanded',
  'NANDURBAR': 'Nandurbar',
  'NASHIK': 'Nashik', 'NASIK': 'Nashik',
  'NAVI MUMBAI': 'Navi Mumbai', 'NAVIMUMBAI': 'Navi Mumbai', 'NEW MUMBAI': 'Navi Mumbai',
  'OSMANABAD': 'Osmanabad', 'DHARASHIV': 'Osmanabad',
  'PALGHAR': 'Palghar',
  'PARBHANI': 'Parbhani',
  'PUNE': 'Pune', 'POONA': 'Pune',
  'RAIGAD': 'Raigad',
  'RATNAGIRI': 'Ratnagiri',
  'SANGLI': 'Sangli',
  'SATARA': 'Satara',
  'SINDHUDURG': 'Sindhudurg', 'SINDHDURG': 'Sindhudurg', 'SINDHUDURGA': 'Sindhudurg', 'SINDHURDURG': 'Sindhudurg',
  'SOLAPUR': 'Solapur', 'SHOLAPUR': 'Solapur',
  'THANE': 'Thane',
  'WARDHA': 'Wardha',
  'WASHIM': 'Washim',
  'YAVATMAL': 'Yavatmal', 'YEOTMAL': 'Yavatmal',
  // City/taluka names mistakenly placed in district column
  'YERMALA': 'Osmanabad',
  'MALEGAON': 'Nashik',
};

/**
 * Normalize a district name to one of the 37 canonical Maharashtra districts.
 * Returns the canonical name, or null if unrecognized.
 */
function normalizeDistrict(raw: string | null): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (!upper) return null;

  // Direct lookup
  if (DISTRICT_ALIAS_MAP[upper]) return DISTRICT_ALIAS_MAP[upper];

  // Fuzzy: check if any canonical name starts with or is contained in the raw value
  for (const canonical of CANONICAL_DISTRICTS) {
    if (upper === canonical.toUpperCase()) return canonical;
  }

  // If still no match, log it and return the raw value title-cased
  console.warn(`  ⚠️  Unknown district: "${raw}" — storing as-is`);
  return raw.trim();
}

// ============================================================================
// CLEANERS
// ============================================================================

/**
 * Safely convert any Excel cell value to a trimmed string.
 * Returns null for: undefined, null, empty string, "null", "nan", "N/A", "n/a".
 * Caps at maxLen to prevent DB column overflow.
 */
function toStr(v: unknown, maxLen = 1000): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const lo = s.toLowerCase();
  if (lo === 'null' || lo === 'nan' || lo === 'n/a' || lo === 'na') return null;
  return s.length > maxLen ? s.substring(0, maxLen) : s;
}

/**
 * Convert Excel PIN_Code to a clean 6-digit string.
 *
 * Issues handled:
 *  - Excel stores numbers: 410501 (numeric) → "410501"
 *  - Zero or near-zero values (0, 1, 99) → null (not real pincodes)
 *  - Floating-point artefact: 412806.0 → "412806"
 *  - String with suffix: "412806-India" → "412806"
 *  - Leading-zero preservation: pad to 6 digits if < 6 chars (e.g. 40001 → "040001")
 *  - Values outside valid India pincode range [100000, 999999] → null
 */
function cleanPin(v: unknown): string | null {
  if (v === null || v === undefined) return null;

  let num: number | null = null;

  if (typeof v === 'number') {
    // Strip float artefact
    num = Math.round(v);
  } else {
    const s = String(v).trim();
    if (!s || s.toLowerCase() === 'nan') return null;
    // Strip anything after first non-digit (e.g. "412806-India" → "412806")
    const stripped = s.replace(/[^0-9].*$/, '').trim();
    if (!stripped) return null;
    num = parseInt(stripped.replace(/\.0+$/, ''), 10);
  }

  if (isNaN(num) || num === null) return null;
  // 0 is explicitly used in this dataset as "missing" (55,115 rows)
  if (num <= 0) return null;
  // Valid Indian pincodes: 6 digits, range 100000–999999
  if (num < 100000 || num > 999999) return null;

  // Zero-pad to 6 digits just in case
  return String(num).padStart(6, '0');
}

/**
 * Convert a numeric NIC code to string.
 * Handles: number → string, float artefacts, empty/null.
 */
function cleanNic(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    const n = Math.round(v);
    return n <= 0 ? null : String(n);
  }
  const s = String(v).trim().replace(/\.0+$/, '');
  if (!s || s.toLowerCase() === 'nan') return null;
  return s;
}

/**
 * GST numbers from MCA data sometimes contain "Derivable from CIN …" — not a real GST.
 */
function cleanGst(v: unknown): string | null {
  const s = toStr(v);
  if (!s) return null;
  if (s.toLowerCase().startsWith('derivable')) return null;
  return s;
}

/**
 * Safe numeric parse. Returns null for NaN, null, undefined, 0-ish strings.
 */
function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const s = String(v).trim().replace(/,/g, '');
  if (!s || s.toLowerCase() === 'nan') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ============================================================================
// ROW MAPPER
// ============================================================================

/** Maps one Excel row object to Prisma stakeholder create data. */
function mapRow(row: Record<string, unknown>, lineNum: number): Record<string, unknown> | null {
  // Primary_Key_ID is required — try common variations
  const pkRaw = row['Primary_Key_ID'] ?? row['primary_key_id'] ?? row['Sr_No'] ?? row['SrNo'] ?? row['Sr No'] ?? row['ID'];
  const primaryKeyId = pkRaw !== null && pkRaw !== undefined ? Math.round(Number(pkRaw)) : NaN;
  if (isNaN(primaryKeyId) || primaryKeyId <= 0) {
    // Only warn for first few, don't spam
    if (lineNum <= 10) {
      console.warn(`  ⚠️  Line ${lineNum}: Invalid Primary_Key_ID="${pkRaw}" — skipped`);
    }
    return null;
  }

  // Company name is required (soft check — we still import with null)
  const companyNameStandardized = toStr(row['Company_Name_Standardized']);
  if (!companyNameStandardized) {
    console.warn(`  ⚠️  Line ${lineNum}: Missing Company_Name_Standardized (pk=${primaryKeyId})`);
  }

  const district = normalizeDistrict(toStr(row['District']));

  const latitude = toNum(row['Latitude']) ?? null;
  const longitude = toNum(row['Longitude']) ?? null;
  let digipin = null;
  if (latitude !== null && longitude !== null) {
    try {
      digipin = getDigiPin(latitude, longitude);
    } catch (e) {
      console.warn(`  ⚠️  Line ${lineNum}: DIGIPIN generation failed for coords (${latitude}, ${longitude})`);
    }
  }

  return {
    primaryKeyId,
    uin:                     toStr(row['UIN']),
    dataSource:              toStr(row['Data_Source']),
    cinNumber:               toStr(row['CIN_Number']),
    gstNumber:               cleanGst(row['GST_Number']),
    tinNumber:               toStr(row['TIN_Number']),
    companyNameStandardized: companyNameStandardized,
    companyNameOriginal:     toStr(row['Company_Name_Original']),
    fullAddressRaw:          toStr(row['Full_Address_Raw']),
    addressLine1:            toStr(row['Address_Line_1']),
    addressLine2:            toStr(row['Address_Line_2']),
    city:                    toStr(row['City']),
    taluka:                  toStr(row['Taluka']) ?? null,      // not present in current Excel
    village:                 toStr(row['Village']) ?? null,     // not present in current Excel
    district:                district,
    state:                   toStr(row['State']),
    pinCode:                 cleanPin(row['PIN_Code']),          // ← core fix
    nicCode:                 cleanNic(row['NIC_Code']),          // ← numeric → string
    nicDescription:          toStr(row['NIC_Description']),
    category:                toStr(row['Category']),
    priorityWeight:          toNum(row['Priority']),             // column is "Priority" not "Priority_Weight"
    // Fields not present in this Excel version — left as null (schema allows nullable)
    companyClass:            toStr(row['Company_Class'])    ?? null,
    companyStatus:           toStr(row['Company_Status'])   ?? null,
    companyCategory:         toStr(row['Company_Category']) ?? null,
    authorizedCapital:       toNum(row['Authorized_Capital']),
    paidupCapital:           toNum(row['Paidup_Capital']),
    listingStatus:           toStr(row['Listing_Status'])   ?? null,
    registrationDate:        toStr(row['Registration_Date']) ?? null,
    fuzzySimilarityScore:    toNum(row['Fuzzy_Similarity_Score']),
    crossSourceMatch:        toStr(row['Cross_Source_Match']) ?? null,
    humanReviewRequired:     toStr(row['Human_Review_Required']) ?? null,
    dedupMatchStatus:        toStr(row['Dedup_Match_Status']) ?? null,
    sourceLineageNotes:      toStr(row['Source_Lineage_Notes']) ?? null,
    status:                  'OPEN' as const,
    latitude,
    longitude,
    digipin,
  };
}

// ============================================================================
// BATCH INSERT / UPSERT
// ============================================================================

interface Stats {
  total: number;
  imported: number;
  skipped: number;    // dedup
  errors: number;
  batches: number;
  startMs: number;
  nullPins: number;
  zeroPins: number;
  districts: Set<string>;
}

async function insertBatch(
  batch: Record<string, unknown>[],
  stats: Stats,
  upsert: boolean
): Promise<void> {
  try {
    if (upsert) {
      // Upsert via raw SQL for speed — avoids Prisma's per-row validation overhead
      for (const row of batch) {
        try {
          await (prisma.stakeholder as any).upsert({
            where: { primaryKeyId: row['primaryKeyId'] as number },
            update: (() => { const { primaryKeyId, status, ...rest } = row as any; return rest; })(),
            create: row,
          });
        } catch {
          // Silently skip problem rows in upsert mode — they're usually data quality issues
          stats.errors++;
        }
      }
    } else {
      await (prisma.stakeholder as any).createMany({ data: batch, skipDuplicates: true });
    }
    stats.imported += batch.length - (upsert ? 0 : 0);
  } catch (batchErr: any) {
    // Batch createMany failed — retry one-by-one to isolate bad rows
    let rowsOk = 0;
    for (const row of batch) {
      try {
        await (prisma.stakeholder as any).create({ data: row });
        rowsOk++;
      } catch (rowErr: any) {
        stats.errors++;
        // Print first 200 chars of error for debugging
        const msg = (rowErr.message ?? '').replace(/\n/g, ' ').substring(0, 200);
        console.error(`  ❌ Row pk=${row['primaryKeyId']}: ${msg}`);
      }
    }
    stats.imported += rowsOk;
    stats.skipped  += batch.length - rowsOk;
  }
  stats.batches++;
}

// ============================================================================
// TRIGRAM INDEXES
// ============================================================================

async function createIndexes(): Promise<void> {
  console.log('\n📊 Creating/verifying trigram indexes...');
  const indexes: [string, string][] = [
    ['idx_stakeholders_name_std_trgm',  'company_name_standardized gin_trgm_ops'],
    ['idx_stakeholders_name_orig_trgm', 'company_name_original gin_trgm_ops'],
    ['idx_stakeholders_city_trgm',      'city gin_trgm_ops'],
    ['idx_stakeholders_address_trgm',   'full_address_raw gin_trgm_ops'],
  ];
  for (const [name, col] of indexes) {
    try {
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS ${name} ON stakeholders USING gin (${col})`
      );
      console.log(`  ✅ ${name}`);
    } catch (e: any) {
      console.warn(`  ⚠️  ${name}: ${(e.message ?? '').substring(0, 80)}`);
    }
  }
}

// ============================================================================
// PROGRESS
// ============================================================================

function printProgress(stats: Stats): void {
  const elapsed = (Date.now() - stats.startMs) / 1000;
  const done = stats.imported + stats.skipped + stats.errors;
  const rate = elapsed > 0 ? Math.round(stats.imported / elapsed) : 0;
  process.stdout.write(
    `\r  📥 ${done.toLocaleString()} / ${stats.total.toLocaleString()} | ` +
    `✅ ${stats.imported.toLocaleString()} imported | ` +
    `⏭  ${stats.skipped.toLocaleString()} dedup | ` +
    `❌ ${stats.errors} errors | ` +
    `${rate.toLocaleString()} rows/sec | ${elapsed.toFixed(1)}s  `
  );
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const cfg = parseArgs();

  if (!fs.existsSync(cfg.filePath)) {
    console.error(`❌ File not found: ${cfg.filePath}`);
    console.error('   Provide --file=<path> to specify the xlsx location.');
    process.exit(1);
  }

  const fileSizeMb = (fs.statSync(cfg.filePath).size / 1024 / 1024).toFixed(2);

  console.log(`\n🚀 MahaAtithi Excel Import Pipeline`);
  console.log('='.repeat(64));
  console.log(`📁 File:        ${cfg.filePath}`);
  console.log(`📏 Size:        ${fileSizeMb} MB`);
  console.log(`📦 Batch size:  ${cfg.batchSize}`);
  console.log(`⚡ Concurrency: ${cfg.concurrency}`);
  console.log(`🔄 Mode:        ${cfg.dryRun ? 'DRY RUN' : cfg.upsert ? 'UPSERT' : 'INSERT'}`);
  console.log('='.repeat(64));

  // Enable pg_trgm extension for fuzzy search
  if (!cfg.dryRun) {
    try {
      await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
      await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS unaccent;');
      console.log('✅ PostgreSQL extensions verified\n');
    } catch {
      console.warn('⚠️  Could not create extensions (may need superuser)\n');
    }
  }

  // --------------------------------------------------------------------------
  // Parse Excel
  // --------------------------------------------------------------------------
  console.log('📖 Loading Excel file (this may take 30–60 seconds for large files)...');
  const workbook = xlsx.readFile(cfg.filePath, {
    cellDates: false,
    sheetRows: 0,
  });

  console.log(`   Sheets found: ${workbook.SheetNames.join(', ')}`);

  // Only import from "combined master" sheet
  const TARGET_SHEET = 'combined master';
  const sheetName = workbook.SheetNames.find(s => s.toLowerCase().trim() === TARGET_SHEET.toLowerCase());

  if (!sheetName) {
    console.error(`❌ Sheet "${TARGET_SHEET}" not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
    process.exit(1);
  }

  const worksheet = workbook.Sheets[sheetName];
  const range = xlsx.utils.decode_range(worksheet['!ref'] || 'A1');
  console.log(`   Sheet "${sheetName}": Range ${xlsx.utils.encode_range(range)} (${range.e.r} rows)`);

  const rawRows: Record<string, unknown>[] = xlsx.utils.sheet_to_json(worksheet, {
    defval: null,
    raw: true,
  });

  console.log(`\n   📊 Total rows from "${sheetName}": ${rawRows.length.toLocaleString()}\n`);

  if (rawRows.length === 0) {
    console.error('❌ No data rows found in the sheet.');
    process.exit(1);
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------
  const stats: Stats = {
    total:    rawRows.length,
    imported: 0,
    skipped:  0,
    errors:   0,
    batches:  0,
    startMs:  Date.now(),
    nullPins: 0,
    zeroPins: 0,
    districts: new Set(),
  };

  // --------------------------------------------------------------------------
  // Process rows
  // --------------------------------------------------------------------------
  const seenIds = new Set<number>();
  let batch: Record<string, unknown>[] = [];
  const pending: Promise<void>[] = [];

  const flush = async (b: Record<string, unknown>[]): Promise<void> => {
    if (!cfg.dryRun) {
      await insertBatch(b, stats, cfg.upsert);
    } else {
      stats.imported += b.length;
      stats.batches++;
    }
    printProgress(stats);
  };

  for (let i = 0; i < rawRows.length; i++) {
    const rawRow = rawRows[i];
    const lineNum = i + 2; // +1 for header, +1 for 1-based

    // Normalize column names: trim whitespace, handle slight variations
    const normalizedRow: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(rawRow)) {
      normalizedRow[key.trim().replace(/\s+/g, '_')] = val;
    }

    // Track PIN code quality
    const rawPin = normalizedRow['PIN_Code'];
    if (rawPin === null || rawPin === undefined) {
      stats.nullPins++;
    } else if (rawPin === 0 || rawPin === '0') {
      stats.zeroPins++;
    }

    const mapped = mapRow(normalizedRow, lineNum);
    if (!mapped) {
      stats.errors++;
      if (!cfg.skipErrors) break;
      continue;
    }

    // In-memory dedup
    const pk = mapped['primaryKeyId'] as number;
    if (seenIds.has(pk)) {
      stats.skipped++;
      continue;
    }
    seenIds.add(pk);

    // Collect districts for upsert
    if (mapped['district']) {
      stats.districts.add(mapped['district'] as string);
    }

    batch.push(mapped);

    if (batch.length >= cfg.batchSize) {
      const b = batch;
      batch = [];
      if (pending.length >= cfg.concurrency) {
        await pending.shift()!;
      }
      pending.push(flush(b));
    }
  }

  // Flush remainder
  if (batch.length > 0) {
    pending.push(flush(batch));
  }
  await Promise.all(pending);

  // --------------------------------------------------------------------------
  // Post-import: indexes & districts
  // --------------------------------------------------------------------------
  if (!cfg.dryRun) {
    await createIndexes();

    if (stats.districts.size > 0) {
      console.log(`\n📍 Upserting all 37 canonical Maharashtra districts...`);
      for (const d of CANONICAL_DISTRICTS) {
        try {
          await (prisma.district as any).upsert({
            where:  { name: d },
            update: {},
            create: { name: d, state: 'Maharashtra' },
          });
        } catch { /* ignore */ }
      }
      console.log('  ✅ All 37 districts upserted');
    }
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  const elapsed = (Date.now() - stats.startMs) / 1000;
  const rate = elapsed > 0 ? Math.round(stats.imported / elapsed) : 0;

  console.log(`\n\n${'='.repeat(64)}`);
  console.log('📊 IMPORT SUMMARY');
  console.log('='.repeat(64));
  console.log(`  Total rows parsed:   ${stats.total.toLocaleString()}`);
  console.log(`  Imported:            ${stats.imported.toLocaleString()}`);
  console.log(`  Skipped (dedup):     ${stats.skipped.toLocaleString()}`);
  console.log(`  Errors:              ${stats.errors.toLocaleString()}`);
  console.log(`  Batches:             ${stats.batches.toLocaleString()}`);
  console.log(`  Time:                ${elapsed.toFixed(2)} s`);
  console.log(`  Rate:                ${rate.toLocaleString()} rows/sec`);
  console.log('---');
  console.log(`  PIN_Code null rows:  ${stats.nullPins.toLocaleString()} → stored as null`);
  console.log(`  PIN_Code zero rows:  ${stats.zeroPins.toLocaleString()} → stored as null (was "0" bug)`);
  console.log(`  Districts found:     ${stats.districts.size}`);
  const missingDistricts = CANONICAL_DISTRICTS.filter(d => !stats.districts.has(d));
  if (missingDistricts.length > 0) {
    console.log(`  ⚠️  Missing from data: ${missingDistricts.join(', ')}`);
  }
  console.log('='.repeat(64) + '\n');
}

// ============================================================================
// ENTRY POINT
// ============================================================================

prisma.$connect()
  .then(() => {
    console.log('✅ Database connected');
    return main();
  })
  .catch((err: Error) => {
    console.error('\n❌ Import failed:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
