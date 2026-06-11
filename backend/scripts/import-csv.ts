/**
 * MahaAthithi CSV Import Pipeline — Improved
 *
 * Pipeline: CSV → Stream → Validate → Deduplicate → Batch(2000) → PostgreSQL → Indexes
 *
 * Imports ~313,604 stakeholder records from the Maharashtra Tourism master database.
 
 * Usage:
 *   npx tsx scripts/import-csv.ts --file=path/to/csv
 *   npx tsx scripts/import-csv.ts --file=path/to/csv --dry-run
 *   npx tsx scripts/import-csv.ts --file=path/to/csv --batch-size=2000
 *   npx tsx scripts/import-csv.ts --file=path/to/csv --upsert
 *   npx tsx scripts/import-csv.ts --file=path/to/csv --resume
 *   npx tsx scripts/import-csv.ts --file=path/to/csv --concurrency=4
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient({
  log: [], // silence Prisma query logs during import
});

// ============================================================================
// CONFIGURATION
// ============================================================================

interface ImportConfig {
  filePath: string;
  batchSize: number;
  dryRun: boolean;
  skipErrors: boolean;
  upsert: boolean;      // update existing records on primaryKeyId conflict
  resume: boolean;      // skip IDs already in the DB (for interrupted runs)
  concurrency: number;  // number of parallel batch inserts
  errorLogPath: string; // write validation/insert errors here
}

function parseArgs(): ImportConfig {
  const args = process.argv.slice(2);
  const config: ImportConfig = {
    filePath: '',
    batchSize: 2000,
    dryRun: false,
    skipErrors: true,
    upsert: false,
    resume: false,
    concurrency: 3,
    errorLogPath: '',
  };

  for (const arg of args) {
    if (arg.startsWith('--file='))        config.filePath = arg.split('=')[1];
    else if (arg.startsWith('--batch-size=')) config.batchSize = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--concurrency=')) config.concurrency = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--error-log=')) config.errorLogPath = arg.split('=')[1];
    else if (arg === '--dry-run')          config.dryRun = true;
    else if (arg === '--strict')           config.skipErrors = false;
    else if (arg === '--upsert')           config.upsert = true;
    else if (arg === '--resume')           config.resume = true;
  }

  if (!config.filePath) {
    console.error('Usage: npx tsx scripts/import-csv.ts --file=<path-to-csv>');
    console.error('\nOptions:');
    console.error('  --file=<path>        Path to CSV file (required)');
    console.error('  --batch-size=<n>     Records per DB batch (default: 2000)');
    console.error('  --concurrency=<n>    Parallel batch inserts (default: 3)');
    console.error('  --dry-run            Validate only, no DB writes');
    console.error('  --strict             Stop on first validation error');
    console.error('  --upsert             Update existing rows on conflict');
    console.error('  --resume             Skip Primary_Key_IDs already in DB');
    console.error('  --error-log=<path>   Write errors to this file (default: import-errors-<ts>.log)');
    process.exit(1);
  }

  if (!config.errorLogPath) {
    config.errorLogPath = path.resolve(
      path.dirname(config.filePath),
      `import-errors-${Date.now()}.log`
    );
  }

  return config;
}

// ============================================================================
// DATA TYPES
// ============================================================================

interface StakeholderRow {
  primaryKeyId:            number;
  uin:                     string | null;
  dataSource:              string | null;
  cinNumber:               string | null;
  gstNumber:               string | null;   // null when value is "Derivable from CIN …"
  tinNumber:               string | null;
  companyNameStandardized: string | null;
  companyNameOriginal:     string | null;
  fullAddressRaw:          string | null;
  addressLine1:            string | null;
  addressLine2:            string | null;
  city:                    string | null;
  taluka:                  string | null;   // absent in CSV → always null
  village:                 string | null;   // absent in CSV → always null
  district:                string | null;
  state:                   string | null;
  pinCode:                 string | null;
  nicCode:                 string | null;
  nicDescription:          string | null;
  category:                string | null;
  priorityWeight:          number | null;
  companyClass:            string | null;
  companyStatus:           string | null;
  companyCategory:         string | null;
  authorizedCapital:       number | null;
  paidupCapital:           number | null;
  listingStatus:           string | null;
  registrationDate:        string | null;
  fuzzySimilarityScore:    number | null;
  crossSourceMatch:        string | null;
  humanReviewRequired:     string | null;
  dedupMatchStatus:        string | null;
  sourceLineageNotes:      string | null;
}

// ============================================================================
// CLEANING & VALIDATION HELPERS
// ============================================================================

function cleanString(value: string | undefined): string | null {
  if (!value) return null;
  const s = value.trim();
  if (s === '' || s.toLowerCase() === 'null' || s.toLowerCase() === 'nan') return null;
  return s;
}

/**
 * PIN_Code is stored as a float in the CSV (due to one null row making pandas
 * infer float64). We must cast "412806.0" → "412806", not leave the ".0".
 */
function cleanPin(value: string | undefined): string | null {
  if (!value) return null;
  const s = value.trim();
  if (!s || s.toLowerCase() === 'nan') return null;
  // Strip floating-point suffix: "412806.0" → "412806"
  const withoutDecimal = s.replace(/\.0+$/, '');
  // Strip trailing "-India" or similar suffixes
  const clean = withoutDecimal.replace(/[^0-9].*$/, '').trim();
  return clean || null;
}

/**
 * GST numbers that say "Derivable from CIN …" are not real GST numbers.
 * Store as null so downstream consumers can derive them if needed.
 */
function cleanGst(value: string | undefined): string | null {
  const s = cleanString(value);
  if (!s) return null;
  if (s.toLowerCase().startsWith('derivable')) return null;
  return s;
}

function parseFloat_(value: string | undefined): number | null {
  if (!value) return null;
  const s = value.trim().replace(/,/g, '');
  if (!s || s.toLowerCase() === 'nan') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseInt_(value: string | undefined): number | null {
  if (!value) return null;
  // Handle "412806.0" from float columns
  const s = value.trim().replace(/\.0+$/, '');
  if (!s || s.toLowerCase() === 'nan') return null;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

/**
 * Registration dates come as "dd-mm-yyyy". Keep as string (schema uses String?).
 * Validate format so corrupt data gets flagged.
 */
function cleanDate(value: string | undefined): string | null {
  const s = cleanString(value);
  if (!s) return null;
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) return s;
  // Accept yyyy-mm-dd too
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null; // malformed — treat as missing, will be reported
}

// ============================================================================
// ROW VALIDATION
// ============================================================================

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  data: StakeholderRow | null;
}

function validateRow(row: Record<string, string>, lineNumber: number): ValidationResult {
  const errors: string[] = [];

  // --- Required: Primary_Key_ID ---
  const primaryKeyId = parseInt_(row['Primary_Key_ID']);
  if (primaryKeyId === null) {
    errors.push(`Line ${lineNumber}: Missing or invalid Primary_Key_ID ("${row['Primary_Key_ID']}")`);
  }

  // --- Required: Company name ---
  const companyNameStandardized = cleanString(row['Company_Name_Standardized']);
  if (!companyNameStandardized) {
    errors.push(`Line ${lineNumber}: Missing Company_Name_Standardized`);
  }

  // --- Optional but warn: District ---
  const rawDistrict = cleanString(row['District']);

  // --- Registration date format ---
  const rawDate = cleanString(row['Registration_Date']);
  const registrationDate = cleanDate(row['Registration_Date']);
  if (rawDate && !registrationDate) {
    // Soft warning — don't fail the row, just note it
    errors.push(`Line ${lineNumber}: Unrecognised Registration_Date format "${rawDate}" — stored as null`);
  }

  if (errors.some(e => e.includes('Missing or invalid Primary_Key_ID'))) {
    return { isValid: false, errors, data: null };
  }

  const data: StakeholderRow = {
    primaryKeyId:            primaryKeyId!,
    uin:                     cleanString(row['UIN']),
    dataSource:              cleanString(row['Data_Source']),
    cinNumber:               cleanString(row['CIN_Number']),
    gstNumber:               cleanGst(row['GST_Number']),
    tinNumber:               cleanString(row['TIN_Number']),
    companyNameStandardized: companyNameStandardized,
    companyNameOriginal:     cleanString(row['Company_Name_Original']),
    fullAddressRaw:          cleanString(row['Full_Address_Raw']),
    addressLine1:            cleanString(row['Address_Line_1']),
    addressLine2:            cleanString(row['Address_Line_2']),
    city:                    cleanString(row['City']),
    taluka:                  null, // not present in this CSV version
    village:                 null, // not present in this CSV version
    district:                rawDistrict ? rawDistrict.toUpperCase() : null,
    state:                   cleanString(row['State']),
    pinCode:                 cleanPin(row['PIN_Code']),
    nicCode:                 cleanString(row['NIC_Code']),
    nicDescription:          cleanString(row['NIC_Description']),
    category:                cleanString(row['Category']),
    priorityWeight:          parseFloat_(row['Priority_Weight']),
    companyClass:            cleanString(row['Company_Class']),
    companyStatus:           cleanString(row['Company_Status']),
    companyCategory:         cleanString(row['Company_Category']),
    authorizedCapital:       parseFloat_(row['Authorized_Capital']),
    paidupCapital:           parseFloat_(row['Paidup_Capital']),
    listingStatus:           cleanString(row['Listing_Status']),
    registrationDate:        registrationDate,
    fuzzySimilarityScore:    parseFloat_(row['Fuzzy_Similarity_Score']),
    crossSourceMatch:        cleanString(row['Cross_Source_Match']),
    humanReviewRequired:     cleanString(row['Human_Review_Required']),
    dedupMatchStatus:        cleanString(row['Dedup_Match_Status']),
    sourceLineageNotes:      cleanString(row['Source_Lineage_Notes']),
  };

  // Soft errors are included in result but row is still valid
  const hardErrors = errors.filter(e => !e.includes('stored as null'));
  return {
    isValid: hardErrors.length === 0,
    errors,
    data: hardErrors.length === 0 ? data : null,
  };
}

// ============================================================================
// IMPORT STATS
// ============================================================================

interface ImportStats {
  totalRows:        number;
  importedRows:     number;
  skippedRows:      number;   // deduplicated or already in DB
  errorRows:        number;
  batchesProcessed: number;
  startTime:        number;
  errors:           string[];
  uniqueDistricts:  Set<string>;
  uniqueCategories: Map<string, number>;
  seenIds:          Set<number>; // in-memory dedup guard
}

// ============================================================================
// BATCH INSERT / UPSERT
// ============================================================================

function buildPrismaData(row: StakeholderRow) {
  return {
    primaryKeyId:            row.primaryKeyId,
    uin:                     row.uin,
    dataSource:              row.dataSource,
    cinNumber:               row.cinNumber,
    gstNumber:               row.gstNumber,
    tinNumber:               row.tinNumber,
    companyNameStandardized: row.companyNameStandardized,
    companyNameOriginal:     row.companyNameOriginal,
    fullAddressRaw:          row.fullAddressRaw,
    addressLine1:            row.addressLine1,
    addressLine2:            row.addressLine2,
    city:                    row.city,
    taluka:                  row.taluka,
    village:                 row.village,
    district:                row.district,
    state:                   row.state,
    pinCode:                 row.pinCode,
    nicCode:                 row.nicCode,
    nicDescription:          row.nicDescription,
    category:                row.category,
    priorityWeight:          row.priorityWeight,
    companyClass:            row.companyClass,
    companyStatus:           row.companyStatus,
    companyCategory:         row.companyCategory,
    authorizedCapital:       row.authorizedCapital,
    paidupCapital:           row.paidupCapital,
    listingStatus:           row.listingStatus,
    registrationDate:        row.registrationDate,
    fuzzySimilarityScore:    row.fuzzySimilarityScore,
    crossSourceMatch:        row.crossSourceMatch,
    humanReviewRequired:     row.humanReviewRequired,
    dedupMatchStatus:        row.dedupMatchStatus,
    sourceLineageNotes:      row.sourceLineageNotes,
    status:                  'OPEN' as const,
  };
}

async function insertBatch(
  batch: StakeholderRow[],
  stats: ImportStats,
  config: ImportConfig
): Promise<void> {
  const data = batch.map(buildPrismaData);

  try {
    if (config.upsert) {
      // Upsert each row — update all fields on conflict
      await Promise.all(
        data.map(row =>
          prisma.stakeholder.upsert({
            where: { primaryKeyId: row.primaryKeyId },
            update: { ...row },
            create: { ...row },
          })
        )
      );
      stats.importedRows += batch.length;
    } else {
      await prisma.stakeholder.createMany({ data, skipDuplicates: true });
      stats.importedRows += batch.length;
    }
  } catch (error: any) {
    // Batch failed — retry row-by-row to isolate the problematic record(s)
    let batchImported = 0;
    for (const row of data) {
      try {
        if (config.upsert) {
          await prisma.stakeholder.upsert({
            where: { primaryKeyId: row.primaryKeyId },
            update: { ...row },
            create: { ...row },
          });
        } else {
          await prisma.stakeholder.create({ data: row });
        }
        batchImported++;
      } catch (rowError: any) {
        stats.errorRows++;
        const msg = `Row primaryKeyId=${row.primaryKeyId}: ${rowError.message?.substring(0, 120)}`;
        if (stats.errors.length < 500) stats.errors.push(msg);
      }
    }
    stats.importedRows += batchImported;
    stats.skippedRows += batch.length - batchImported;
  }
}

// ============================================================================
// TRIGRAM INDEXES
// ============================================================================

async function createTrigramIndexes(): Promise<void> {
  console.log('\n📊 Creating trigram indexes for fuzzy search...');

  const indexes: [string, string][] = [
    ['idx_stakeholders_name_std_trgm',  'company_name_standardized gin_trgm_ops'],
    ['idx_stakeholders_name_orig_trgm', 'company_name_original gin_trgm_ops'],
    ['idx_stakeholders_city_trgm',      'city gin_trgm_ops'],
    ['idx_stakeholders_address_trgm',   'full_address_raw gin_trgm_ops'],
  ];

  for (const [name, column] of indexes) {
    const sql = `CREATE INDEX IF NOT EXISTS ${name} ON stakeholders USING gin (${column})`;
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log(`  ✅ ${name}`);
    } catch (e: any) {
      console.log(`  ⚠️  ${name}: ${e.message?.substring(0, 80)}`);
    }
  }
}

// ============================================================================
// RESUME: LOAD EXISTING IDs
// ============================================================================

async function loadExistingIds(): Promise<Set<number>> {
  console.log('🔍 Loading existing Primary_Key_IDs from DB for resume mode...');
  const existing = await prisma.stakeholder.findMany({
    select: { primaryKeyId: true },
  });
  const ids = new Set(existing.map(r => r.primaryKeyId));
  console.log(`  Found ${ids.size.toLocaleString()} existing records — will skip these.\n`);
  return ids;
}

// ============================================================================
// DISTRICT UPSERT
// ============================================================================

async function upsertDistricts(districts: Set<string>): Promise<void> {
  console.log('\n📍 Upserting district records...');
  for (const district of districts) {
    try {
      await prisma.district.upsert({
        where: { name: district },
        update: {},
        create: { name: district, state: 'Maharashtra' },
      });
    } catch (_) { /* ignore */ }
  }
  console.log(`  ✅ ${districts.size} districts upserted`);
}

// ============================================================================
// MAIN IMPORT PIPELINE
// ============================================================================

async function importCSV(config: ImportConfig): Promise<void> {
  const stats: ImportStats = {
    totalRows:        0,
    importedRows:     0,
    skippedRows:      0,
    errorRows:        0,
    batchesProcessed: 0,
    startTime:        Date.now(),
    errors:           [],
    uniqueDistricts:  new Set(),
    uniqueCategories: new Map(),
    seenIds:          new Set(),
  };

  const filePath = path.resolve(config.filePath);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  const fileSize = fs.statSync(filePath).size;
  console.log(`\n🚀 MahaAthithi CSV Import Pipeline`);
  console.log('='.repeat(60));
  console.log(`📁 File:        ${filePath}`);
  console.log(`📏 Size:        ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`📦 Batch size:  ${config.batchSize}`);
  console.log(`⚡ Concurrency: ${config.concurrency}`);
  console.log(`🔄 Mode:        ${config.dryRun ? 'DRY RUN' : config.upsert ? 'UPSERT' : 'INSERT'}`);
  console.log(`📝 Error log:   ${config.errorLogPath}`);
  console.log('='.repeat(60) + '\n');

  // Extensions
  if (!config.dryRun) {
    try {
      await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
      await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS unaccent;');
      console.log('✅ PostgreSQL extensions verified\n');
    } catch (_) {
      console.log('⚠️  Could not create extensions (may need superuser)\n');
    }
  }

  // Resume mode: pre-load existing IDs
  let existingIds: Set<number> = new Set();
  if (config.resume && !config.dryRun) {
    existingIds = await loadExistingIds();
  }

  const errorLogStream = config.dryRun
    ? null
    : fs.createWriteStream(config.errorLogPath, { flags: 'a' });

  let batch: StakeholderRow[] = [];
  let lineNumber = 1;
  const pendingBatches: Promise<void>[] = [];

  const flushBatch = async (b: StakeholderRow[]) => {
    if (!config.dryRun) {
      await insertBatch(b, stats, config);
    } else {
      stats.importedRows += b.length;
    }
    stats.batchesProcessed++;
    printProgress(stats);
  };

  const parser = fs.createReadStream(filePath).pipe(
    parse({
      columns:            true,
      skip_empty_lines:   true,
      trim:               true,
      cast:               false,
      relax_column_count: true,
      bom:                true, // handle UTF-8 BOM if present
    })
  );

  for await (const row of parser) {
    lineNumber++;
    stats.totalRows++;

    const validation = validateRow(row, lineNumber);

    // Record all errors (including soft warnings) to log
    if (validation.errors.length > 0 && errorLogStream) {
      errorLogStream.write(validation.errors.join('\n') + '\n');
    }

    if (!validation.isValid) {
      stats.errorRows++;
      if (stats.errors.length < 100) stats.errors.push(...validation.errors.filter(e => !e.includes('stored as null')));
      if (!config.skipErrors) {
        console.error(`\n❌ Validation error at line ${lineNumber}:`);
        validation.errors.forEach(e => console.error(`   ${e}`));
        break;
      }
      continue;
    }

    const data = validation.data!;

    // In-memory dedup (same CSV file having duplicate Primary_Key_IDs)
    if (stats.seenIds.has(data.primaryKeyId)) {
      stats.skippedRows++;
      continue;
    }
    stats.seenIds.add(data.primaryKeyId);

    // Resume mode: skip IDs already in DB
    if (config.resume && existingIds.has(data.primaryKeyId)) {
      stats.skippedRows++;
      continue;
    }

    // Collect stats
    if (data.district)  stats.uniqueDistricts.add(data.district);
    if (data.category) {
      stats.uniqueCategories.set(data.category, (stats.uniqueCategories.get(data.category) ?? 0) + 1);
    }

    batch.push(data);

    if (batch.length >= config.batchSize) {
      const b = batch;
      batch = [];

      // Concurrency control: wait if too many batches in flight
      if (pendingBatches.length >= config.concurrency) {
        await pendingBatches.shift()!;
      }
      pendingBatches.push(flushBatch(b));
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    pendingBatches.push(flushBatch(batch));
  }
  await Promise.all(pendingBatches);

  // Post-import: trigram indexes & districts
  if (!config.dryRun) {
    await createTrigramIndexes();
    if (stats.uniqueDistricts.size > 0) {
      await upsertDistricts(stats.uniqueDistricts);
    }
  }

  // Close error log
  if (errorLogStream) {
    errorLogStream.end();
    if (stats.errors.length === 0) {
      fs.unlinkSync(config.errorLogPath); // no errors → clean up empty file
    } else {
      console.log(`\n📄 Errors written to: ${config.errorLogPath}`);
    }
  }

  // Summary
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = elapsed > 0 ? Math.round(stats.importedRows / elapsed) : 0;

  console.log(`\n\n${'='.repeat(60)}`);
  console.log('📊 IMPORT SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Total Rows:      ${stats.totalRows.toLocaleString()}`);
  console.log(`  Imported:        ${stats.importedRows.toLocaleString()}`);
  console.log(`  Skipped (dedup): ${stats.skippedRows.toLocaleString()}`);
  console.log(`  Errors:          ${stats.errorRows.toLocaleString()}`);
  console.log(`  Batches:         ${stats.batchesProcessed.toLocaleString()}`);
  console.log(`  Time:            ${elapsed.toFixed(2)} s`);
  console.log(`  Rate:            ${rate.toLocaleString()} rows/sec`);
  console.log(`  Districts found: ${stats.uniqueDistricts.size}`);
  console.log(`  Categories:      ${stats.uniqueCategories.size}`);

  if (stats.uniqueDistricts.size > 0) {
    console.log(`\n📍 Districts:\n  ${[...stats.uniqueDistricts].sort().join('\n  ')}`);
  }

  if (stats.uniqueCategories.size > 0) {
    console.log('\n🏷️  Categories:');
    const sorted = [...stats.uniqueCategories.entries()].sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sorted) {
      console.log(`  ${cat.padEnd(30)} ${count.toLocaleString()}`);
    }
  }

  if (stats.errors.length > 0) {
    console.log(`\n⚠️  First ${Math.min(stats.errors.length, 10)} errors:`);
    stats.errors.slice(0, 10).forEach(e => console.log(`   ${e}`));
    console.log(`   (see ${config.errorLogPath} for full list)`);
  }

  console.log('='.repeat(60) + '\n');
}

// ============================================================================
// PROGRESS
// ============================================================================

function printProgress(stats: ImportStats): void {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = elapsed > 0 ? Math.round(stats.importedRows / elapsed) : 0;
  const processed = stats.importedRows + stats.skippedRows + stats.errorRows;
  process.stdout.write(
    `\r  📥 ${processed.toLocaleString()} rows | ` +
    `✅ ${stats.importedRows.toLocaleString()} imported | ` +
    `⏭  ${stats.skippedRows.toLocaleString()} skipped | ` +
    `❌ ${stats.errorRows} errors | ` +
    `${rate.toLocaleString()} rows/sec | ` +
    `${elapsed.toFixed(1)}s  `
  );
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const config = parseArgs();

  try {
    await prisma.$connect();
    console.log('✅ Database connected');
    await importCSV(config);
  } catch (error) {
    console.error('\n❌ Import failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();