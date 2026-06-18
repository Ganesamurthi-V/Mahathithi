import { prisma } from '../config/database';
import fs from 'fs';
import path from 'path';

async function seedPoliceStationsLocally() {
  console.log('Clearing old police stations...');
  await prisma.facility.deleteMany({ where: { type: 'POLICE_STATION' } });

  const dataPath = path.join(__dirname, '../../data/police_stations.json');
  
  if (!fs.existsSync(dataPath)) {
    console.error(`ERROR: File not found at ${dataPath}`);
    console.error('Please create this file and paste your JSON data into it.');
    process.exit(1);
  }

  console.log('Reading local JSON file...');
  const fileContent = fs.readFileSync(dataPath, 'utf-8');
  
  if (!fileContent.trim()) {
    console.log('File is empty. Please paste your JSON data into backend/data/police_stations.json');
    process.exit(1);
  }

  let jsonData;
  try {
    jsonData = JSON.parse(fileContent);
  } catch (err) {
    console.error('ERROR: Invalid JSON format. Please ensure the file contains valid JSON.');
    process.exit(1);
  }

  // If the user wrapped the ESRI JSON in an array like [ { features: [...] } ], unwrap it
  if (Array.isArray(jsonData) && jsonData.length > 0 && jsonData[0].features) {
    jsonData = jsonData[0];
  }

  // Handle both ESRI Feature format and Flat Array format
  let itemsToInsert: any[] = [];

  if (jsonData.features && Array.isArray(jsonData.features)) {
    // It's a FeatureCollection (either ESRI nested or already flattened)
    console.log('Detected FeatureCollection format.');
    for (const feature of jsonData.features) {
      // Handle both nested (ESRI) and flattened formats
      const attr = feature.attributes || feature;
      const geom = feature.geometry || { x: feature.longitude, y: feature.latitude };

      const name = attr.policestationname || attr.name;
      const longitude = geom.x || geom.longitude;
      const latitude = geom.y || geom.latitude;

      if (!longitude || !latitude || !name) {
        continue;
      }

      itemsToInsert.push({
        name: name,
        type: 'POLICE_STATION',
        district: attr.district || null,
        state: attr.state || null,
        longitude: Number(longitude),
        latitude: Number(latitude),
      });
    }
  } else if (Array.isArray(jsonData)) {
    // It's a flat array
    console.log('Detected flat JSON array format.');
    for (const item of jsonData) {
      // Look for common property names that might contain the data
      const name = item.policestationname || item.name || item.stationName;
      const district = item.district || item.districtName;
      const state = item.state || item.stateName;
      const longitude = item.longitude || item.lng || item.x;
      const latitude = item.latitude || item.lat || item.y;

      if (name && longitude && latitude) {
        itemsToInsert.push({
          name: name,
          type: 'POLICE_STATION',
          district: district || null,
          state: state || null,
          longitude: Number(longitude),
          latitude: Number(latitude),
        });
      }
    }
  } else {
    console.error('ERROR: Unrecognized JSON format. Must be a flat array [] or an object with a "features" array.');
    process.exit(1);
  }

  console.log(`Found ${itemsToInsert.length} valid police stations to insert.`);
  
  if (itemsToInsert.length === 0) {
    console.log('Nothing to insert.');
    return;
  }

  // Insert in batches of 1000 to avoid overloading the Prisma query builder
  const batchSize = 1000;
  for (let i = 0; i < itemsToInsert.length; i += batchSize) {
    const batch = itemsToInsert.slice(i, i + batchSize);
    await prisma.facility.createMany({
      data: batch,
      skipDuplicates: true, // Safety measure
    });
    console.log(`Inserted ${Math.min(i + batchSize, itemsToInsert.length)} / ${itemsToInsert.length}...`);
  }

  console.log(`Finished! Successfully inserted ${itemsToInsert.length} total police stations.`);
}

seedPoliceStationsLocally()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
