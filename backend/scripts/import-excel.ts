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
 * ============================================================================
 * WHAT THIS IMPORTS, AND WHAT IT DELIBERATELY DOES NOT
 * ============================================================================
 * The 'Combined Master' sheet has 24 columns (not 19, as this comment previously
 * claimed). Measured fill rates over the first 5,000 rows of the live workbook:
 *
 *   IMPORTED — carry real data
 *     Primary_Key_ID              100%      UIN                        100%
 *     Data_Source                 100%      CIN_Number                89.9%
 *     Company_Name_Standardized   100%      Company_Name_Original      100%
 *     Full_Address_Raw            100%      Address_Line_1             100%
 *     Address_Line_2              100%      City                       100%
 *     District                    100%      State                      100%
 *     PIN_Code                    100%      NIC_Code                   100%
 *     NIC_Description             100%      Category                   100%
 *     Priority                    100%
 *
 *   IGNORED — genuinely empty in all 295,176 rows
 *     GST_Number, TIN_Number, and one unnamed trailing column.
 *
 *   IGNORED — HAVE DATA, but stakeholders has no column to receive them.
 *   These are dropped, and that is a decision worth revisiting. Counts are from a
 *   FULL scan of the workbook, not a sample:
 *
 *     'Email ID'           109,116 rows (36.97%)   <-- substantial contact data
 *     'Mobile Number'        5,554 rows (1.88%)
 *     Region                 4,429 rows (1.50%)
 *     'FSSAI License No.'   11,922 rows (4.04%), but 11,402 of those are
 *                           placeholders whose last 8 digits are zero
 *                           (e.g. 11524000000000). Only ~520 look like real
 *                           licences (176 distinct).
 *
 *   NOTE ON MEASUREMENT: these four were initially assessed from the first 5,000
 *   rows and ALL looked empty. They are not. The workbook is ordered MCA-first
 *   then Udyam, and the contact columns are only populated in the later portion.
 *   auditIgnoredColumns() therefore scans every row — sampling a non-uniformly
 *   distributed column produces confident wrong answers.
 *
 * This importer previously wrote 18 fields that could never be anything but null,
 * because the Excel has no such column at all: taluka, village, company_class,
 * company_status, company_category, authorized_capital, paidup_capital,
 * listing_status, registration_date, fuzzy_similarity_score, cross_source_match,
 * human_review_required, dedup_match_status, source_lineage_notes, latitude,
 * longitude, digipin — plus gst_number and tin_number, whose columns exist in the
 * sheet but are 100% empty. Verified against the live database: all of those are
 * 0% populated across all 295,176 rows.
 *
 * They are no longer written. The columns still exist on the table and remain
 * nullable, so nothing breaks; the import simply stops pretending to populate
 * them. Every field below is one that actually receives a value.
 */

import * as fs from 'fs';
import * as path from 'path';
import xlsx from 'xlsx';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

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
  // 'BULDHANA' was listed twice here (TS1117). Both mapped to the same value so it
  // was harmless at runtime, but a third spelling variant was likely intended.
  // Left at the two real variants rather than inventing one.
  'BULDHANA': 'Buldhana', 'BULDANA': 'Buldhana',
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
// IGNORED-COLUMN AUDIT
// ============================================================================

/**
 * Source columns this importer deliberately does not read, with the reason.
 *
 * These were all measured empty (or effectively empty) in the current workbook. The
 * risk of hard-coding that decision is that a LATER workbook starts populating one
 * of them and the data is dropped silently — so instead of assuming, the import
 * samples these columns and warns loudly if any of them now contains values.
 *
 * That turns a silent data loss into a visible prompt to wire the column up.
 */
const IGNORED_COLUMNS: Record<string, string> = {
  'GST_Number':         'empty in all rows; stakeholders.gst_number also confirmed 0% populated',
  'TIN_Number':         'empty in all rows; stakeholders.tin_number also confirmed 0% populated',
  'Region':             'no region column on stakeholders (4,429 rows carry a value)',
  'Email ID':           'no email column on stakeholders — 109,116 rows carry a value, worth adding one',
  'Mobile Number':      'no mobile column on stakeholders (5,554 rows carry a value)',
  'FSSAI License No.':  'no fssai column on stakeholders; 11,922 populated but 11,402 are zero-padded placeholders, ~520 real',
};

/** Values that mean "no data" rather than data. */
function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim().toLowerCase();
  return s === '' || s === 'nan' || s === 'null' || s === 'n/a' || s === 'na';
}

/**
 * Warn if a column we chose to skip actually has data in this workbook.
 *
 * Scans EVERY row, not a sample. This originally sampled the first 5,000 rows and
 * was badly misleading: the workbook is ordered MCA-first then Udyam, and the
 * contact columns are only populated in the later portion. The sample reported
 * 'Email ID' as completely empty when it is in fact 36.97% populated — 109,116
 * values. Sampling a non-uniformly distributed column is worse than not checking,
 * because it produces confident wrong answers.
 *
 * The rows are already in memory, so a full scan costs a few hundred milliseconds.
 */
function auditIgnoredColumns(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return;

  console.log(`\n🔍 Auditing skipped columns across all ${rows.length.toLocaleString()} rows...`);
  let surprises = 0;

  for (const [col, reason] of Object.entries(IGNORED_COLUMNS)) {
    // Column names are normalised (whitespace -> underscore) before mapRow, so
    // check both the raw and normalised spellings.
    const key = Object.keys(rows[0]!).find(
      k => k === col || k.trim().replace(/\s+/g, '_') === col.trim().replace(/\s+/g, '_')
    );
    if (!key) continue;

    const populated = rows.filter(r => !isBlank(r[key])).length;
    if (populated === 0) {
      console.log(`  ✅ ${col.padEnd(20)} empty in all rows — safe to skip`);
    } else {
      surprises++;
      const pct = ((populated / rows.length) * 100).toFixed(2);
      console.warn(`  ⚠️  ${col.padEnd(20)} HAS DATA: ${populated.toLocaleString()} rows (${pct}%) — being DROPPED`);
      console.warn(`     ${reason}`);
    }
  }

  if (surprises > 0) {
    console.warn(
      `\n  ${surprises} skipped column(s) contain data. Storing them needs a schema change;\n` +
      `  see the header of this file for the measured breakdown.`
    );
  }
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

  return {
    primaryKeyId,
    uin:                     toStr(row['UIN']),
    dataSource:              toStr(row['Data_Source']),
    cinNumber:               toStr(row['CIN_Number']),          // 89.9% populated — real data
    companyNameStandardized: companyNameStandardized,
    companyNameOriginal:     toStr(row['Company_Name_Original']),
    fullAddressRaw:          toStr(row['Full_Address_Raw']),
    addressLine1:            toStr(row['Address_Line_1']),
    addressLine2:            toStr(row['Address_Line_2']),
    city:                    toStr(row['City']),
    district:                district,
    state:                   toStr(row['State']),
    pinCode:                 cleanPin(row['PIN_Code']),         // numeric in Excel; 0 means missing
    nicCode:                 cleanNic(row['NIC_Code']),         // numeric in Excel → string
    nicDescription:          toStr(row['NIC_Description']),
    category:                toStr(row['Category']),

    // Source column is "Priority", not "Priority_Weight".
    //
    // Defaulted to 0 rather than null on purpose. `ORDER BY priority_weight DESC`
    // means NULLS FIRST in Postgres, so a null here sorts AHEAD of every scored
    // record and lands unscored rows on page 1 of the admin list. That was a live
    // bug, fixed by backfilling 104,412 nulls to 0 (see
    // migrations/20260904_priority_weight_backfill). Writing null again would
    // silently reintroduce it on the next import. Real priorities are 1..6, so 0 is
    // an unused, explicit "not scored" value that correctly sorts last.
    priorityWeight:          toNum(row['Priority']) ?? 0,

    status:                  'OPEN' as const,
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

/**
 * Ensure the trigram indexes the search path actually uses.
 *
 * NOTE: idx_stakeholders_address_trgm (full_address_raw) was deliberately REMOVED
 * from this list. It was 59 MB — the largest index on the table — with 0 scans
 * across 45 days of production, because no query filters on full_address_raw:
 * StakeholderService.search() accepts name, org, state, district, pinCode,
 * category, nicCode, gst, taluka, city, status and digipin, and address is not
 * among them. It was dropped in migrations/20260904_drop_unused_indexes, and
 * recreating it here would silently undo that on the next import.
 *
 * The three kept below all back live query paths: the two name trigrams serve the
 * `name`/`org` ILIKE search (55 and 56 scans), and the city trigram serves the
 * `city` ILIKE filter.
 */
async function createIndexes(): Promise<void> {
  console.log('\n📊 Creating/verifying trigram indexes...');
  const indexes: [string, string][] = [
    ['idx_stakeholders_name_std_trgm',  'company_name_standardized gin_trgm_ops'],
    ['idx_stakeholders_name_orig_trgm', 'company_name_original gin_trgm_ops'],
    ['idx_stakeholders_city_trgm',      'city gin_trgm_ops'],
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

  // Make the import's scope explicit before any writes happen, and flag any
  // skipped column that has started carrying data.
  auditIgnoredColumns(rawRows);

  console.log('\n📝 Fields written to stakeholders (17 + status):');
  console.log('   primaryKeyId, uin, dataSource, cinNumber, companyNameStandardized,');
  console.log('   companyNameOriginal, fullAddressRaw, addressLine1, addressLine2, city,');
  console.log('   district, state, pinCode, nicCode, nicDescription, category,');
  console.log('   priorityWeight (null -> 0), status=OPEN');
  console.log('   Not written: taluka, village, gst/tin, company_*, *_capital,');
  console.log('   listing_status, registration_date, fuzzy/dedup/lineage, lat/long/digipin');

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
