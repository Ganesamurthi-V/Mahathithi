import xlsx from 'xlsx';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// The path relative to the backend/scripts directory
const FILE_PATH = path.resolve(__dirname, '../../Final_Mahaathithi.xlsx');

// Batch size to prevent memory limit errors or Supabase connection timeouts
const BATCH_SIZE = 5000;

async function main() {
  console.log('Loading Excel file. This might take 30-60 seconds for 318k rows...');
  
  const workbook = xlsx.readFile(FILE_PATH);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  console.log('Converting sheet to JSON...');
  // defval: null ensures empty cells are parsed as null rather than missing completely
  const rows = xlsx.utils.sheet_to_json(worksheet, { defval: null });
  
  console.log(`Successfully parsed ${rows.length} rows. Starting database insertion...`);

  // Insert in chunks
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    
    const mappedData = chunk.map((row: any) => ({
      primaryKeyId: Number(row['Primary_Key_ID']),
      uin: row['UIN'] ? String(row['UIN']) : null,
      dataSource: row['Data_Source'] ? String(row['Data_Source']) : null,
      cinNumber: row['CIN_Number'] ? String(row['CIN_Number']) : null,
      gstNumber: row['GST_Number'] ? String(row['GST_Number']) : null,
      tinNumber: row['TIN_Number'] ? String(row['TIN_Number']) : null,
      companyNameStandardized: row['Company_Name_Standardized'] ? String(row['Company_Name_Standardized']) : null,
      companyNameOriginal: row['Company_Name_Original'] ? String(row['Company_Name_Original']) : null,
      fullAddressRaw: row['Full_Address_Raw'] ? String(row['Full_Address_Raw']) : null,
      addressLine1: row['Address_Line_1'] ? String(row['Address_Line_1']) : null,
      addressLine2: row['Address_Line_2'] ? String(row['Address_Line_2']) : null,
      city: row['City'] ? String(row['City']) : null,
      district: row['District'] ? String(row['District']) : null,
      state: row['State'] ? String(row['State']) : null,
      // Convert numbers to strings for PIN and NIC
      pinCode: row['PIN_Code'] !== null ? String(row['PIN_Code']) : null,
      nicCode: row['NIC_Code'] !== null ? String(row['NIC_Code']) : null,
      nicDescription: row['NIC_Description'] ? String(row['NIC_Description']) : null,
      category: row['Category'] ? String(row['Category']) : null,
      priorityWeight: row['Priority'] !== null ? Number(row['Priority']) : null,
    }));

    // Use createMany to insert in bulk
    await prisma.stakeholder.createMany({
      data: mappedData,
      // skipDuplicates is helpful if the script fails midway and you need to restart it
      skipDuplicates: true,
    });
    
    console.log(`Seeded ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length} records...`);
  }
  
  console.log('✅ Seeding complete! All data has been successfully added to Supabase.');
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
