import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/index.js';
import { listingImages, listings } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'images');

const MAX_EDGE = 1500;
const WEBP_QUALITY = 85;

export async function processImage(originalPath: string, listingId: number, index: number, platform: string): Promise<{ resizedPath: string; width: number; height: number }> {
  const inputPath = path.join(DATA_DIR, originalPath);
  if (!fs.existsSync(inputPath)) throw new Error(`Image not found: ${inputPath}`);

  const resizedDir = path.join(DATA_DIR, 'resized', platform, String(listingId));
  fs.mkdirSync(resizedDir, { recursive: true });

  const filename = `${index}.webp`;
  const outputPath = path.join(resizedDir, filename);
  const relativePath = path.join('resized', platform, String(listingId), filename);

  const metadata = await sharp(inputPath).metadata();
  const longestEdge = Math.max(metadata.width ?? 0, metadata.height ?? 0);

  let pipeline = sharp(inputPath);
  if (longestEdge > MAX_EDGE) {
    pipeline = pipeline.resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true });
  }

  const result = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer({ resolveWithObject: true });
  fs.writeFileSync(outputPath, result.data);

  return {
    resizedPath: relativePath,
    width: result.info.width,
    height: result.info.height,
  };
}

export async function processListingImages(listingId: number): Promise<number> {
  const listing = await db.select().from(listings).where(eq(listings.id, listingId)).get();
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
      console.warn(`[processor] Failed to process image ${img.localPathOriginal}: ${err.message}`);
    }
  }

  return processed;
}

export async function getImageBase64(imagePath: string): Promise<{ base64: string; mediaType: string }> {
  const fullPath = path.join(DATA_DIR, imagePath);
  const buffer = fs.readFileSync(fullPath);
  const base64 = buffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const mediaType = ext === '.webp' ? 'image/webp' : ext === '.png' ? 'image/png' : 'image/jpeg';
  return { base64, mediaType };
}
