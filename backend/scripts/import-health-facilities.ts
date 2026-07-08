/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-var-requires */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { getDigiPin } from '../src/utils/digipin';

// stream-json v3+ uses kebab-case file names and requires .js extension for Node 24 exports map
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chain } = require('stream-chain') as { chain: (...args: any[]) => NodeJS.ReadableStream };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parser } = require('stream-json') as { parser: () => NodeJS.ReadWriteStream };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pick } = require('stream-json/filters/pick.js') as { pick: (opts: { filter: string }) => NodeJS.ReadWriteStream };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { streamArray } = require('stream-json/streamers/stream-array.js') as { streamArray: () => NodeJS.ReadWriteStream };

const prisma = new PrismaClient();
const BATCH_SIZE = 5000;

interface FacilityRecord {
  name: string;
  type: string;
  district: string | null;
  state: string | null;
  latitude: number;
  longitude: number;
  digipin: string | null;
}

async function processBatch(batch: FacilityRecord[]): Promise<number> {
  try {
    const result = await prisma.facility.createMany({
      data: batch,
      skipDuplicates: true,
    });
    return result.count;
  } catch (err) {
    console.error('Batch insert failed:', err);
    return 0;
  }
}

async function main(): Promise<void> {
  const filePath = path.join(__dirname, '../data/health_facilities.json');
  console.log(`Starting import from ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.error('File not found!');
    process.exit(1);
  }

  let batch: FacilityRecord[] = [];
  let totalImported = 0;
  let totalFailed = 0;
  let totalProcessed = 0;

  const pipeline = chain([
    fs.createReadStream(filePath),
    parser(),
    pick({ filter: 'features' }),
    streamArray(),
  ]);

  return new Promise<void>((resolve, reject) => {
    pipeline.on('data', (data: { key: number; value: any }) => {
      const { value } = data;
      totalProcessed++;

      if (!value || !value.attributes) {
        totalFailed++;
        return;
      }

      const attrs = value.attributes;

      const facilityName: string | undefined = attrs.facilityname?.toString().trim();
      // Use the specific facility type from JSON, fallback to HEALTHCARE
      const facilityType: string = attrs.facilitytype?.toString().trim() || 'HEALTHCARE';
      const district: string | null = attrs.district?.toString().trim() || null;
      const state: string | null = attrs.state?.toString().trim() || null;
      const lat: unknown = attrs.lat;
      const lon: unknown = attrs.lon;

      if (!facilityName) {
        totalFailed++;
        return;
      }

      const finalLat = typeof lat === 'number' ? lat : 0;
      const finalLon = typeof lon === 'number' ? lon : 0;
      let digipin = null;
      if (finalLat !== 0 && finalLon !== 0) {
        try { digipin = getDigiPin(finalLat, finalLon); } catch (e) {}
      }

      batch.push({
        name: facilityName,
        type: facilityType,
        district,
        state,
        latitude: finalLat,
        longitude: finalLon,
        digipin,
      });

      if (batch.length >= BATCH_SIZE) {
        pipeline.pause();
        const currentBatch = batch;
        batch = [];

        processBatch(currentBatch)
          .then((count) => {
            totalImported += count;
            totalFailed += currentBatch.length - count;
            console.log(`Imported ${totalImported} records so far... (processed: ${totalProcessed})`);
            pipeline.resume();
          })
          .catch((err) => {
            console.error('Unexpected batch error:', err);
            totalFailed += currentBatch.length;
            pipeline.resume();
          });
      }
    });

    pipeline.on('end', () => {
      if (batch.length > 0) {
        processBatch(batch)
          .then((count) => {
            totalImported += count;
            totalFailed += batch.length - count;
            console.log(`Imported final batch. Total: ${totalImported}`);
          })
          .catch((err) => {
            console.error('Final batch insert failed:', err);
            totalFailed += batch.length;
          })
          .finally(() => {
            console.log(`\nImport complete!`);
            console.log(`Total records processed: ${totalProcessed}`);
            console.log(`Total successfully imported: ${totalImported}`);
            console.log(`Total failed/skipped: ${totalFailed}`);
            prisma.$disconnect().then(resolve).catch(resolve);
          });
      } else {
        console.log(`\nImport complete!`);
        console.log(`Total records processed: ${totalProcessed}`);
        console.log(`Total successfully imported: ${totalImported}`);
        console.log(`Total failed/skipped: ${totalFailed}`);
        prisma.$disconnect().then(resolve).catch(resolve);
      }
    });

    pipeline.on('error', (err: Error) => {
      console.error('Pipeline error:', err);
      prisma.$disconnect().then(() => reject(err)).catch(() => reject(err));
    });
  });
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
