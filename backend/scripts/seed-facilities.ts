import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { getDigiPin } from '../src/utils/digipin';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting facilities seed...');

  // 1. Police Stations
  console.log('Reading Police Stations...');
  const policeData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/maharashtra_police_stations.json'), 'utf8'));
  
  const policeStations = policeData.features
    .filter((f: any) => f.latitude != null && f.longitude != null)
    .map((f: any) => {
      const lat = parseFloat(f.latitude);
      const lon = parseFloat(f.longitude);
      let digipin = null;
      try { digipin = getDigiPin(lat, lon); } catch (e) {}
      return {
        name: f.name || 'Unknown Police Station',
        type: 'POLICE_STATION',
        district: f.district || null,
        state: f.state || null,
        latitude: lat,
        longitude: lon,
        digipin,
      };
    });

  console.log(`Prepared ${policeStations.length} police stations.`);
  
  // 2. Health Facilities
  console.log('Reading Health Facilities...');
  const healthData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/maharashtra_health_facilities.json'), 'utf8'));

  const healthFacilities = healthData.features
    .filter((f: any) => f.latitude != null && f.longitude != null)
    .map((f: any) => {
      const lat = parseFloat(f.latitude);
      const lon = parseFloat(f.longitude);
      let digipin = null;
      try { digipin = getDigiPin(lat, lon); } catch (e) {}
      return {
        name: f.facilityname || 'Unknown Health Facility',
        type: 'HEALTHCARE',
        district: f.district || null,
        state: f.state || null,
        latitude: lat,
        longitude: lon,
        digipin,
      };
    });

  console.log(`Prepared ${healthFacilities.length} health facilities.`);

  const allFacilities = [...policeStations, ...healthFacilities];
  console.log(`Total valid facilities to insert: ${allFacilities.length}`);

  // Insert in batches
  const batchSize = 5000;
  for (let i = 0; i < allFacilities.length; i += batchSize) {
    const batch = allFacilities.slice(i, i + batchSize);
    console.log(`Inserting batch ${i + 1} to ${i + batch.length}...`);
    await prisma.facility.createMany({
      data: batch,
      skipDuplicates: true,
    });
  }

  console.log('Seeding complete! Successfully imported into Supabase.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
