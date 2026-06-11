import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Adding OPEN to StakeholderStatus enum...');
  try {
    await prisma.$executeRawUnsafe(`ALTER TYPE "StakeholderStatus" ADD VALUE IF NOT EXISTS 'OPEN'`);
    console.log('Added OPEN to enum successfully.');
  } catch (e: any) {
    console.log('Enum value OPEN might already exist:', e.message);
  }

  console.log('Mapping old statuses to OPEN...');
  
  const result = await prisma.$executeRawUnsafe(`
    UPDATE stakeholders 
    SET status = 'OPEN' 
    WHERE status IN ('PENDING', 'IN_PROGRESS', 'IN_REVIEW')
  `);
  
  console.log(`Updated ${result} rows successfully.`);
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
