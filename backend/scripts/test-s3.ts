/**
 * S3 Connectivity Test Script
 * Run: npx tsx scripts/test-s3.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { S3Client, PutObjectCommand, ListBucketsCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

async function testS3() {
  console.log('\n🔍 S3 Connectivity Test\n');
  console.log('━'.repeat(50));

  // 1. Check env vars
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const bucket = process.env.S3_BUCKET_NAME;

  console.log(`  AWS_REGION:           ${region || '❌ MISSING'}`);
  console.log(`  AWS_ACCESS_KEY_ID:    ${accessKeyId ? accessKeyId.substring(0, 8) + '...' : '❌ MISSING'}`);
  console.log(`  AWS_SECRET_ACCESS_KEY:${secretAccessKey ? ' ✅ SET (' + secretAccessKey.length + ' chars)' : ' ❌ MISSING'}`);
  console.log(`  S3_BUCKET_NAME:       ${bucket || '❌ MISSING'}`);
  console.log('━'.repeat(50));

  if (!accessKeyId || !secretAccessKey || !bucket) {
    console.log('\n❌ Missing required env vars. Cannot proceed.');
    return;
  }

  const s3 = new S3Client({
    region: region || 'ap-south-1',
    credentials: { accessKeyId, secretAccessKey },
  });

  // 2. Test listing buckets
  console.log('\n📦 Step 1: Listing buckets...');
  try {
    const bucketsRes = await s3.send(new ListBucketsCommand({}));
    const bucketNames = bucketsRes.Buckets?.map(b => b.Name) || [];
    console.log(`  ✅ Found ${bucketNames.length} buckets: ${bucketNames.join(', ')}`);
    
    if (!bucketNames.includes(bucket)) {
      console.log(`  ⚠️  WARNING: Bucket "${bucket}" not found in your account!`);
      console.log(`  Available buckets: ${bucketNames.join(', ') || 'none'}`);
    }
  } catch (err: any) {
    console.log(`  ❌ FAILED: ${err.message}`);
    console.log(`  Error Code: ${err.Code || err.name}`);
    return;
  }

  // 3. Test bucket access
  console.log(`\n🪣 Step 2: Checking access to "${bucket}"...`);
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`  ✅ Bucket "${bucket}" is accessible!`);
  } catch (err: any) {
    console.log(`  ❌ FAILED: ${err.message}`);
    console.log(`  Error Code: ${err.Code || err.name}`);
    return;
  }

  // 4. Test upload
  console.log(`\n📤 Step 3: Test uploading a small file...`);
  try {
    const testKey = `test/connectivity_test_${Date.now()}.txt`;
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: testKey,
      Body: Buffer.from(`S3 connectivity test at ${new Date().toISOString()}`),
      ContentType: 'text/plain',
    }));
    console.log(`  ✅ Upload successful! Key: ${testKey}`);
  } catch (err: any) {
    console.log(`  ❌ Upload FAILED: ${err.message}`);
    console.log(`  Error Code: ${err.Code || err.name}`);
    return;
  }

  console.log('\n' + '━'.repeat(50));
  console.log('🎉 ALL TESTS PASSED — S3 connectivity is working!\n');
}

testS3().catch(console.error);
