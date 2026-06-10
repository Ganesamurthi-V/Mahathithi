/**
 * MahaAthithi CSV Import Pipeline
 *
 * Pipeline: CSV → Stream → Validate → Batch(1000) → PostgreSQL → Indexed Search
 *
 * Imports ~313,604 stakeholder records from the Maharashtra Tourism master database.
 * Uses streaming for memory efficiency and batch inserts for performance.
 *
 * Usage:
 *   npx tsx scripts/import-csv.ts --file=path/to/csv
 *   npx tsx scripts/import-csv.ts --file=path/to/csv --dry-run
 *   npx tsx scripts/import-csv.ts --file=path/to/csv --batch-size=500
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

// ============================================================================
// CONFIGURATION
// ============================================================================

interface ImportConfig {
  filePath: string;
  batchSize: number;
  dryRun: boolean;
  skipErrors: boolean;
}

function parseArgs(): ImportConfig {
  const args = process.argv.slice(2);
  const config: ImportConfig = {
    filePath: '',
    batchSize: 1000,
    dryRun: false,
    skipErrors: true,
  };

  for (const arg of args) {
    if (arg.startsWith('--file=')) {
      config.filePath = arg.split('=')[1];
    } else if (arg.startsWith('--batch-size=')) {
      config.batchSize = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--dry-run') {
      config.dryRun = true;
    } else if (arg === '--strict') {
      config.skipErrors = false;
    }
  }

  if (!config.filePath) {
    console.error('Usage: npx tsx scripts/import-csv.ts --file=<path-to-csv>');
    console.error('Options:');
    console.error('  --file=<path>        Path to CSV file (required)');
    console.error('  --batch-size=<n>     Batch size for inserts (default: 1000)');
    console.error('  --dry-run            Validate without inserting');
    console.error('  --strict             Stop on first validation error');
    process.exit(1);
  }

  return config;
}

// ============================================================================
// VALIDATION
// ============================================================================

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  data: StakeholderRow | null;
}

interface StakeholderRow {
  primaryKeyId: number;
  uin: string | null;
  dataSource: string | null;
  cinNumber: string | null;
  gstNumber: string | null;
  tinNumber: string | null;
  companyNameStandardized: string | null;
  companyNameOriginal: string | null;
  fullAddressRaw: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pinCode: string | null;
  nicCode: string | null;
  nicDescription: string | null;
  category: string | null;
  priorityWeight: number | null;
  companyClass: string | null;
  companyStatus: string | null;
  companyCategory: string | null;
  authorizedCapital: number | null;
  paidupCapital: number | null;
  listingStatus: string | null;
  registrationDate: string | null;
  fuzzySimilarityScore: number | null;
  crossSourceMatch: string | null;
  humanReviewRequired: string | null;
  dedupMatchStatus: string | null;
  sourceLineageNotes: string | null;
}

function cleanString(value: string | undefined): string | null {
  if (!value || value.trim() === '' || value.trim().toLowerCase() === 'null') {
    return null;
  }
  return value.trim();
}

function parseNumber(value: string | undefined): number | null {
  if (!value || value.trim() === '') return null;
  const num = parseFloat(value.trim().replace(/,/g, ''));
  return isNaN(num) ? null : num;
}

function parseInt_(value: string | undefined): number | null {
  if (!value || value.trim() === '') return null;
  const num = parseInt(value.trim(), 10);
  return isNaN(num) ? null : num;
}

function validateRow(row: Record<string, string>, lineNumber: number): ValidationResult {
  const errors: string[] = [];

  // Required field: Primary_Key_ID
  const primaryKeyId = parseInt_(row['Primary_Key_ID']);
  if (primaryKeyId === null) {
    errors.push(`Line ${lineNumber}: Missing or invalid Primary_Key_ID`);
  }

  // Validate PIN code format (6 digits for India)
  const pinCode = cleanString(row['PIN_Code']);
  if (pinCode && !/^\d{6}$/.test(pinCode.replace(/-.*$/, ''))) {
    // Some PINs have format like "412806-India", extract just the number
  }

  // Extract clean PIN (remove "-India" suffix if present)
  const cleanPin = pinCode ? pinCode.replace(/-.*$/, '').trim() : null;

  if (errors.length > 0) {
    return { isValid: false, errors, data: null };
  }

  const data: StakeholderRow = {
    primaryKeyId: primaryKeyId!,
    uin: cleanString(row['UIN']),
    dataSource: cleanString(row['Data_Source']),
    cinNumber: cleanString(row['CIN_Number']),
    gstNumber: cleanString(row['GST_Number']),
    tinNumber: cleanString(row['TIN_Number']),
    companyNameStandardized: cleanString(row['Company_Name_Standardized']),
    companyNameOriginal: cleanString(row['Company_Name_Original']),
    fullAddressRaw: cleanString(row['Full_Address_Raw']),
    addressLine1: cleanString(row['Address_Line_1']),
    addressLine2: cleanString(row['Address_Line_2']),
    city: cleanString(row['City']),
    district: cleanString(row['District']),
    state: cleanString(row['State']),
    pinCode: cleanPin,
    nicCode: cleanString(row['NIC_Code']),
    nicDescription: cleanString(row['NIC_Description']),
    category: cleanString(row['Category']),
    priorityWeight: parseNumber(row['Priority_Weight']),
    companyClass: cleanString(row['Company_Class']),
    companyStatus: cleanString(row['Company_Status']),
    companyCategory: cleanString(row['Company_Category']),
    authorizedCapital: parseNumber(row['Authorized_Capital']),
    paidupCapital: parseNumber(row['Paidup_Capital']),
    listingStatus: cleanString(row['Listing_Status']),
    registrationDate: cleanString(row['Registration_Date']),
    fuzzySimilarityScore: parseNumber(row['Fuzzy_Similarity_Score']),
    crossSourceMatch: cleanString(row['Cross_Source_Match']),
    humanReviewRequired: cleanString(row['Human_Review_Required']),
    dedupMatchStatus: cleanString(row['Dedup_Match_Status']),
    sourceLineageNotes: cleanString(row['Source_Lineage_Notes']),
  };

  return { isValid: true, errors: [], data };
}

// ============================================================================
// IMPORT PIPELINE
// ============================================================================

interface ImportStats {
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  errorRows: number;
  batchesProcessed: number;
  startTime: number;
  errors: string[];
  uniqueDistricts: Set<string>;
  uniqueCategories: Set<string>;
}

async function createTrigramIndexes(): Promise<void> {
  console.log('\n📊 Creating trigram indexes for fuzzy search...');

  const indexes = [
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stakeholders_name_std_trgm
     ON stakeholders USING gin (company_name_standardized gin_trgm_ops)`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stakeholders_name_orig_trgm
     ON stakeholders USING gin (company_name_original gin_trgm_ops)`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stakeholders_city_trgm
     ON stakeholders USING gin (city gin_trgm_ops)`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stakeholders_address_trgm
     ON stakeholders USING gin (full_address_raw gin_trgm_ops)`,
  ];

  for (const indexSql of indexes) {
    try {
      await prisma.$executeRawUnsafe(indexSql);
      console.log(`  ✅ Index created`);
    } catch (error: any) {
      // CONCURRENTLY can fail in transaction, try without
      const nonConcurrent = indexSql.replace(' CONCURRENTLY', '');
      try {
        await prisma.$executeRawUnsafe(nonConcurrent);
        console.log(`  ✅ Index created (non-concurrent)`);
      } catch (innerError: any) {
        console.log(`  ⚠️  Index may already exist: ${innerError.message?.substring(0, 80)}`);
      }
    }
  }
}

async function importCSV(importConfig: ImportConfig): Promise<void> {
  const stats: ImportStats = {
    totalRows: 0,
    importedRows: 0,
    skippedRows: 0,
    errorRows: 0,
    batchesProcessed: 0,
    startTime: Date.now(),
    errors: [],
    uniqueDistricts: new Set(),
    uniqueCategories: new Set(),
  };

  const filePath = path.resolve(importConfig.filePath);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  const fileSize = fs.statSync(filePath).size;
  console.log(`\n🚀 MahaAthithi CSV Import Pipeline`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📁 File: ${filePath}`);
  console.log(`📏 Size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`📦 Batch Size: ${importConfig.batchSize}`);
  console.log(`🔄 Mode: ${importConfig.dryRun ? 'DRY RUN (no inserts)' : 'LIVE IMPORT'}`);
  console.log(`${'='.repeat(60)}\n`);

  // Ensure extensions
  if (!importConfig.dryRun) {
    try {
      await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
      await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS unaccent;`);
      console.log('✅ PostgreSQL extensions verified\n');
    } catch (e) {
      console.log('⚠️  Could not create extensions (may need superuser)\n');
    }
  }

  let batch: StakeholderRow[] = [];
  let lineNumber = 1; // 1-indexed (header is line 1)

  const parser = fs.createReadStream(filePath)
    .pipe(parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      cast: false,
      relax_column_count: true,
    }));

  for await (const row of parser) {
    lineNumber++;
    stats.totalRows++;

    const validation = validateRow(row, lineNumber);

    if (!validation.isValid) {
      stats.errorRows++;
      if (stats.errors.length < 50) {
        stats.errors.push(...validation.errors);
      }
      if (!importConfig.skipErrors) {
        console.error(`\n❌ Validation error at line ${lineNumber}:`);
        validation.errors.forEach(e => console.error(`   ${e}`));
        break;
      }
      continue;
    }

    const data = validation.data!;

    // Track unique values
    if (data.district) stats.uniqueDistricts.add(data.district.toUpperCase());
    if (data.category) stats.uniqueCategories.add(data.category);

    batch.push(data);

    if (batch.length >= importConfig.batchSize) {
      if (!importConfig.dryRun) {
        await insertBatch(batch, stats);
      } else {
        stats.importedRows += batch.length;
      }
      stats.batchesProcessed++;

      // Progress report every 10 batches
      if (stats.batchesProcessed % 10 === 0) {
        const elapsed = (Date.now() - stats.startTime) / 1000;
        const rate = Math.round(stats.importedRows / elapsed);
        process.stdout.write(
          `\r  📥 Processed: ${stats.importedRows.toLocaleString()} rows | ` +
          `${rate.toLocaleString()} rows/sec | ` +
          `Errors: ${stats.errorRows} | ` +
          `Elapsed: ${elapsed.toFixed(1)}s`
        );
      }

      batch = [];
    }
  }

  // Insert remaining batch
  if (batch.length > 0) {
    if (!importConfig.dryRun) {
      await insertBatch(batch, stats);
    } else {
      stats.importedRows += batch.length;
    }
    stats.batchesProcessed++;
  }

  // Create trigram indexes after import
  if (!importConfig.dryRun) {
    await createTrigramIndexes();
  }

  // Auto-create districts
  if (!importConfig.dryRun && stats.uniqueDistricts.size > 0) {
    console.log('\n\n📍 Creating district records...');
    for (const district of stats.uniqueDistricts) {
      try {
        await prisma.district.upsert({
          where: { name: district },
          update: {},
          create: { name: district, state: 'Maharashtra' },
        });
      } catch (e) {
        // ignore duplicates
      }
    }
    console.log(`  ✅ Created ${stats.uniqueDistricts.size} district records`);
  }

  // Print summary
  const elapsed = (Date.now() - stats.startTime) / 1000;
  console.log(`\n\n${'='.repeat(60)}`);
  console.log(`📊 IMPORT SUMMARY`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Total Rows:      ${stats.totalRows.toLocaleString()}`);
  console.log(`  Imported:        ${stats.importedRows.toLocaleString()}`);
  console.log(`  Skipped:         ${stats.skippedRows.toLocaleString()}`);
  console.log(`  Errors:          ${stats.errorRows.toLocaleString()}`);
  console.log(`  Batches:         ${stats.batchesProcessed.toLocaleString()}`);
  console.log(`  Time:            ${elapsed.toFixed(2)} seconds`);
  console.log(`  Rate:            ${Math.round(stats.importedRows / elapsed).toLocaleString()} rows/sec`);
  console.log(`  Districts Found: ${stats.uniqueDistricts.size}`);
  console.log(`  Categories:      ${stats.uniqueCategories.size}`);

  if (stats.uniqueDistricts.size > 0) {
    console.log(`\n📍 Districts: ${[...stats.uniqueDistricts].sort().join(', ')}`);
  }

  if (stats.errors.length > 0) {
    console.log(`\n⚠️  First ${Math.min(stats.errors.length, 10)} errors:`);
    stats.errors.slice(0, 10).forEach(e => console.log(`   ${e}`));
  }

  console.log(`${'='.repeat(60)}\n`);
}

async function insertBatch(batch: StakeholderRow[], stats: ImportStats): Promise<void> {
  try {
    await prisma.stakeholder.createMany({
      data: batch.map(row => ({
        primaryKeyId: row.primaryKeyId,
        uin: row.uin,
        dataSource: row.dataSource,
        cinNumber: row.cinNumber,
        gstNumber: row.gstNumber,
        tinNumber: row.tinNumber,
        companyNameStandardized: row.companyNameStandardized,
        companyNameOriginal: row.companyNameOriginal,
        fullAddressRaw: row.fullAddressRaw,
        addressLine1: row.addressLine1,
        addressLine2: row.addressLine2,
        city: row.city,
        district: row.district,
        state: row.state,
        pinCode: row.pinCode,
        nicCode: row.nicCode,
        nicDescription: row.nicDescription,
        category: row.category,
        priorityWeight: row.priorityWeight,
        companyClass: row.companyClass,
        companyStatus: row.companyStatus,
        companyCategory: row.companyCategory,
        authorizedCapital: row.authorizedCapital,
        paidupCapital: row.paidupCapital,
        listingStatus: row.listingStatus,
        registrationDate: row.registrationDate,
        fuzzySimilarityScore: row.fuzzySimilarityScore,
        crossSourceMatch: row.crossSourceMatch,
        humanReviewRequired: row.humanReviewRequired,
        dedupMatchStatus: row.dedupMatchStatus,
        sourceLineageNotes: row.sourceLineageNotes,
        status: 'PENDING',
      })),
      skipDuplicates: true,
    });
    stats.importedRows += batch.length;
  } catch (error: any) {
    // If batch fails, try individual inserts to find problematic rows
    console.warn(`\n  ⚠️  Batch failed, retrying individually...`);
    let batchImported = 0;
    for (const row of batch) {
      try {
        await prisma.stakeholder.create({
          data: {
            primaryKeyId: row.primaryKeyId,
            uin: row.uin,
            dataSource: row.dataSource,
            cinNumber: row.cinNumber,
            gstNumber: row.gstNumber,
            tinNumber: row.tinNumber,
            companyNameStandardized: row.companyNameStandardized,
            companyNameOriginal: row.companyNameOriginal,
            fullAddressRaw: row.fullAddressRaw,
            addressLine1: row.addressLine1,
            addressLine2: row.addressLine2,
            city: row.city,
            district: row.district,
            state: row.state,
            pinCode: row.pinCode,
            nicCode: row.nicCode,
            nicDescription: row.nicDescription,
            category: row.category,
            priorityWeight: row.priorityWeight,
            companyClass: row.companyClass,
            companyStatus: row.companyStatus,
            companyCategory: row.companyCategory,
            authorizedCapital: row.authorizedCapital,
            paidupCapital: row.paidupCapital,
            listingStatus: row.listingStatus,
            registrationDate: row.registrationDate,
            fuzzySimilarityScore: row.fuzzySimilarityScore,
            crossSourceMatch: row.crossSourceMatch,
            humanReviewRequired: row.humanReviewRequired,
            dedupMatchStatus: row.dedupMatchStatus,
            sourceLineageNotes: row.sourceLineageNotes,
            status: 'PENDING',
          },
        });
        batchImported++;
      } catch (rowError: any) {
        stats.errorRows++;
        if (stats.errors.length < 50) {
          stats.errors.push(
            `Row ${row.primaryKeyId}: ${rowError.message?.substring(0, 100)}`
          );
        }
      }
    }
    stats.importedRows += batchImported;
    stats.skippedRows += (batch.length - batchImported);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const importConfig = parseArgs();

  try {
    await prisma.$connect();
    console.log('✅ Database connected');

    await importCSV(importConfig);
  } catch (error) {
    console.error('\n❌ Import failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
