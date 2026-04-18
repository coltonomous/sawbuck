import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import logger from './logger.js';

const bucket = process.env.S3_BUCKET || '';
const region = process.env.S3_REGION || process.env.AWS_REGION || 'us-west-2';

const client = new S3Client({ region });

export function isS3Configured(): boolean {
  return bucket.length > 0;
}

export async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<void> {
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
}

export async function downloadFromS3(key: string): Promise<Buffer> {
  const response = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }));
  return Buffer.from(await response.Body!.transformToByteArray());
}

export async function deleteFromS3(key: string): Promise<void> {
  try {
    await client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }));
  } catch (err) {
    logger.warn({ key, error: String(err) }, 'S3 delete failed (non-fatal)');
  }
}

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export function mimeFromExt(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] || 'image/jpeg';
}
