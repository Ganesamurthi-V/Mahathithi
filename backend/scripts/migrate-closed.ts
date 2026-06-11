import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Adding CLOSED to StakeholderStatus enum...');
  try {
    await prisma.$executeRawUnsafe(`ALTER TYPE "StakeholderStatus" ADD VALUE IF NOT EXISTS 'CLOSED'`);
    console.log('Added CLOSED to enum successfully.');
  } catch (e: any) {
    console.log('Enum value CLOSED might already exist:', e.message);
  }

  console.log('Mapping COMPLETED statuses to CLOSED...');
  
  const result = await prisma.$executeRawUnsafe(`
    UPDATE stakeholders 
    SET status = 'CLOSED' 
    WHERE status = 'COMPLETED'
  `);
  
  console.log(`Updated ${result} rows successfully.`);
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
