import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // Create districts (Skipped per user request)
  // console.log('📍 Creating Maharashtra districts...');
  // for (const districtName of MAHARASHTRA_DISTRICTS) {
  //   await prisma.district.upsert({ ... });
  // }

  // Create admin user
  console.log('👤 Creating admin user...');
  const adminPassword = await bcrypt.hash('admin@123', 12);
  const admin = await prisma.enumerator.upsert({
    where: { loginId: 'admin' },
    update: {},
    create: {
      loginId: 'admin',
      passwordHash: adminPassword,
      name: 'System Administrator',
      phone: '9999999999',
      email: 'admin@mahaatithi.gov.in',
      isAdmin: true,
      isActive: true,
    },
  });
  console.log(`  ✅ Admin user created (loginId: admin, password: admin@123)\n`);

  // Create sample enumerators
  console.log('👥 Creating sample enumerators...');
  const sampleEnumerators = [
    { loginId: 'enum_wardha_01', name: 'Rajesh Kumar', districts: ['WARDHA'] },
    { loginId: 'enum_nagpur_01', name: 'Priya Sharma', districts: ['NAGPUR'] },
    { loginId: 'enum_multi_01', name: 'Amit Patel', districts: ['WARDHA', 'AMRAVATI'] },
    { loginId: 'enum_pune_01', name: 'Sneha Deshmukh', districts: ['PUNE'] },
    { loginId: 'enum_mumbai_01', name: 'Vikram Singh', districts: ['MUMBAI', 'THANE'] },
  ];

  const enumPassword = await bcrypt.hash('enum@123', 12);

  for (const enumData of sampleEnumerators) {
    const enumerator = await prisma.enumerator.upsert({
      where: { loginId: enumData.loginId },
      update: {},
      create: {
        loginId: enumData.loginId,
        passwordHash: enumPassword,
        name: enumData.name,
        isAdmin: false,
        isActive: true,
      },
    });

    // Assign districts
    for (const districtName of enumData.districts) {
      const district = await prisma.district.findUnique({
        where: { name: districtName },
      });
      if (district) {
        await prisma.enumeratorDistrict.upsert({
          where: {
            enumeratorId_districtId: {
              enumeratorId: enumerator.id,
              districtId: district.id,
            },
          },
          update: {},
          create: {
            enumeratorId: enumerator.id,
            districtId: district.id,
          },
        });
      }
    }

    console.log(`  ✅ ${enumData.name} → ${enumData.districts.join(', ')}`);
  }

  console.log(`\n🎉 Seeding complete!`);
  console.log(`\n📋 Login Credentials:`);
  console.log(`  Admin:       admin / admin@123`);
  console.log(`  Enumerators: enum_wardha_01 / enum@123 (and others)`);
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
