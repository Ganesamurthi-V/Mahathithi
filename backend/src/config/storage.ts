import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './index';
import { logger } from '../utils/logger';

const s3ClientConfig: any = {
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
};

if (config.aws.s3Endpoint) {
  s3ClientConfig.endpoint = config.aws.s3Endpoint;
  s3ClientConfig.forcePathStyle = true;
}

export const s3Client = new S3Client(s3ClientConfig);

export async function uploadToS3(
  key: string,
  body: Buffer | ReadableStream,
  contentType: string,
  metadata?: Record<string, string>
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: config.aws.s3Bucket,
    Key: key,
    Body: body as any,
    ContentType: contentType,
    Metadata: metadata,
  });

  await s3Client.send(command);
  logger.info(`Uploaded to S3: ${key}`);
  return key;
}

export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: config.aws.s3Bucket,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

export async function deleteFromS3(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: config.aws.s3Bucket,
    Key: key,
  });

  await s3Client.send(command);
  logger.info(`Deleted from S3: ${key}`);
}

export function generateS3Key(
  type: 'photo' | 'video' | 'thumbnail',
  surveyId: string,
  fileName: string
): string {
  const date = new Date().toISOString().split('T')[0];
  return `${type}s/${date}/${surveyId}/${fileName}`;
}
