import sharp from 'sharp';
import path from 'path';
import { db } from '../db/index.js';
import { listingImages, listings } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { config } from '../lib/config.js';
import { uploadToS3, downloadFromS3 } from '../lib/s3.js';
import logger from '../lib/logger.js';

const MAX_EDGE = config.images.maxEdge;
const WEBP_QUALITY = config.images.webpQuality;

export async function processImage(originalPath: string, listingId: number, index: number, platform: string): Promise<{ resizedPath: string; width: number; height: number }> {
  const inputBuffer = await downloadFromS3(originalPath);

  const s3Key = `resized/${platform}/${listingId}/${index}.webp`;

  const metadata = await sharp(inputBuffer).metadata();
  const longestEdge = Math.max(metadata.width ?? 0, metadata.height ?? 0);

  let pipeline = sharp(inputBuffer);
  if (longestEdge > MAX_EDGE) {
    pipeline = pipeline.resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true });
  }

  const result = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer({ resolveWithObject: true });
  await uploadToS3(s3Key, result.data, 'image/webp');

  return {
    resizedPath: s3Key,
    width: result.info.width,
    height: result.info.height,
  };
}

export async function processListingImages(listingId: number): Promise<number> {
  const listing = await db.select().from(listings).where(eq(listings.id, listingId)).then(r => r[0]);
  if (!listing) throw new Error(`Listing ${listingId} not found`);

  const images = await db.select()
    .from(listingImages)
    .where(and(
      eq(listingImages.listingId, listingId),
      eq(listingImages.downloadStatus, 'downloaded'),
    ));

  const unprocessed = images.filter((img) => !img.localPathResized && img.localPathOriginal);
  if (unprocessed.length === 0) return 0;

  let processed = 0;
  for (let i = 0; i < unprocessed.length; i++) {
    const img = unprocessed[i];
    try {
      const result = await processImage(img.localPathOriginal!, listingId, i, listing.platform);

      await db.update(listingImages).set({
        localPathResized: result.resizedPath,
        width: result.width,
        height: result.height,
      }).where(eq(listingImages.id, img.id));

      processed++;
    } catch (err: any) {
      logger.warn({ imagePath: img.localPathOriginal, err: err.message }, 'Failed to process image');
    }
  }

  return processed;
}

export async function getImageBase64(imagePath: string): Promise<{ base64: string; mediaType: string }> {
  const buffer = await downloadFromS3(imagePath);
  const base64 = buffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const mediaType = ext === '.webp' ? 'image/webp' : ext === '.png' ? 'image/png' : 'image/jpeg';
  return { base64, mediaType };
}
