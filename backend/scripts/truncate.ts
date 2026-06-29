import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function truncateAll() {
  console.log('Fetching table names...');
  // Get all table names in the public schema
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname='public';
  `;

  console.log('Truncating tables...');
  for (const { tablename } of tables) {
    // Skip prisma migrations and specified tables
    const ignoredTables = [
      '_prisma_migrations',
      'facilities',
      'police_station',
      'police_stations',
      'healthcare',
      'healthcares'
    ];
    
    if (ignoredTables.includes(tablename)) {
      console.log(`Skipping table: ${tablename}`);
      continue;
    }

    try {
      // CASCADE ensures that dependent rows in other tables are also deleted
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE;`);
      console.log(`- Truncated table: ${tablename}`);
    } catch (error) {
      console.error(`Error truncating table ${tablename}:`, error);
    }
  }

  console.log('✅ All tables have been successfully cleared.');
}

truncateAll()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
