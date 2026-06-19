import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.facility.deleteMany();
  console.log(`Deleted ${result.count} facilities`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
