/**
 * Generate a presigned (temporarily viewable) URL for an object in the media bucket.
 *
 * The bucket is private, so a bare
 * https://<bucket>.s3.<region>.amazonaws.com/<key> URL always returns
 * AccessDenied. A presigned URL carries a short-lived signature in the query
 * string that grants read access without making the object public.
 *
 * Usage:
 *   npx tsx scripts/presign.ts <s3-key-or-full-url> [expiresInSeconds]
 *
 * Examples:
 *   npx tsx scripts/presign.ts photos/2026-08-26/abc/def.jpg
 *   npx tsx scripts/presign.ts "https://mahaathithi-media.s3.ap-south-1.amazonaws.com/photos/2026-08-26/abc/def.jpg" 86400
 */
import dotenv from 'dotenv';
dotenv.config();

import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const DEFAULT_EXPIRY_SECONDS = 3600;
// S3 SigV4 presigned URLs cannot outlive 7 days.
const MAX_EXPIRY_SECONDS = 604800;

/**
 * Accept either a bare S3 key or a full https URL and return just the key.
 * Path segments are URL-decoded because S3 console links percent-encode them.
 */
function toKey(input: string): string {
  let raw = input.trim();

  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    // Drop any existing (likely expired) signature params, keep only the path.
    raw = url.pathname;

    // Path-style URLs look like /<bucket>/<key>; virtual-hosted style is /<key>.
    const bucket = process.env.S3_BUCKET_NAME;
    if (bucket && raw.startsWith(`/${bucket}/`)) {
      raw = raw.slice(bucket.length + 2);
    }
  }

  return decodeURIComponent(raw.replace(/^\/+/, ''));
}

async function main() {
  const [inputArg, expiryArg] = process.argv.slice(2);

  if (!inputArg) {
    console.error('Usage: npx tsx scripts/presign.ts <s3-key-or-full-url> [expiresInSeconds]');
    process.exit(1);
  }

  const region = process.env.AWS_REGION || 'ap-south-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const bucket = process.env.S3_BUCKET_NAME;

  const missing = [
    !accessKeyId && 'AWS_ACCESS_KEY_ID',
    !secretAccessKey && 'AWS_SECRET_ACCESS_KEY',
    !bucket && 'S3_BUCKET_NAME',
  ].filter(Boolean);

  if (missing.length > 0) {
    console.error(`Missing required env var(s): ${missing.join(', ')}`);
    console.error('Set them in backend/.env');
    process.exit(1);
  }

  let expiresIn = expiryArg ? parseInt(expiryArg, 10) : DEFAULT_EXPIRY_SECONDS;
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) expiresIn = DEFAULT_EXPIRY_SECONDS;
  if (expiresIn > MAX_EXPIRY_SECONDS) {
    console.warn(`Requested expiry exceeds the 7-day S3 maximum; clamping to ${MAX_EXPIRY_SECONDS}s.`);
    expiresIn = MAX_EXPIRY_SECONDS;
  }

  const key = toKey(inputArg);

  const s3 = new S3Client({
    region,
    credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
  });

  console.log(`Bucket: ${bucket}`);
  console.log(`Region: ${region}`);
  console.log(`Key:    ${key}`);

  // Confirm the object exists first, so a 404 isn't mistaken for a broken signature.
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket!, Key: key }));
    const sizeKb = head.ContentLength ? (head.ContentLength / 1024).toFixed(1) : '?';
    console.log(`Found:  ${head.ContentType || 'unknown type'}, ${sizeKb} KB`);
  } catch (err: any) {
    const code = err?.name || err?.Code;
    if (code === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
      console.error('\nObject does not exist at that key.');
      console.error('Check the key against the media table\'s file_path column.');
    } else if (code === 'Forbidden' || err?.$metadata?.httpStatusCode === 403) {
      console.error('\nAccess denied reading the object metadata.');
      console.error('The IAM user needs s3:GetObject on this bucket.');
    } else {
      console.error(`\nCould not verify the object: ${err.message}`);
    }
    process.exit(1);
  }

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket!, Key: key }),
    { expiresIn }
  );

  const hours = (expiresIn / 3600).toFixed(1);
  console.log(`\nPresigned URL (valid ${expiresIn}s / ~${hours}h):\n`);
  console.log(url);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
