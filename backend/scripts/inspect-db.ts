import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const surveys = await prisma.survey.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: { id: true, stakeholderId: true, isSynced: true, localId: true }
  });
  console.log('Surveys in DB:', surveys);

  const media = await prisma.media.findMany({
    take: 5,
    orderBy: { capturedAt: 'desc' },
    select: { id: true, surveyId: true, filePath: true }
  });
  console.log('Media in DB:', media);
}

check().catch(console.error).finally(() => prisma.$disconnect());
