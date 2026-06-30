import xlsx from 'xlsx';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FILE_PATH = path.resolve(__dirname, '../../Final_Mahaathithi.xlsx');

async function main() {
  console.log('Loading Excel file. This might take 30-60 seconds...');
  
  const workbook = xlsx.readFile(FILE_PATH);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  console.log('Converting sheet to JSON...');
  const rows = xlsx.utils.sheet_to_json(worksheet, { defval: null });
  
  console.log(`Successfully parsed ${rows.length} rows. extracting districts...`);

  // Extract unique districts
  const districtsSet = new Set<string>();
  
  for (const row of rows as any[]) {
    if (row['District'] && typeof row['District'] === 'string') {
      const districtName = row['District'].trim();
      if (districtName) {
        districtsSet.add(districtName);
      }
    }
  }

  const uniqueDistricts = Array.from(districtsSet).sort();
  console.log(`Found ${uniqueDistricts.length} unique districts:`, uniqueDistricts);

  console.log('Inserting into database...');
  for (const districtName of uniqueDistricts) {
    try {
      await prisma.district.upsert({
        where: { name: districtName },
        update: {},
        create: {
          name: districtName,
          state: 'Maharashtra',
        }
      });
    } catch (e: any) {
      console.error(`Failed to upsert ${districtName}:`, e.message);
    }
  }

  console.log('District seeding completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
