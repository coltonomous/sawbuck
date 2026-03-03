import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/index.js';
import { listingImages, listings } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'images');

const REFERERS: Record<string, string> = {
  craigslist: 'https://craigslist.org/',
  offerup: 'https://offerup.com/',
  mercari: 'https://www.mercari.com/',
};

function getExtFromUrl(url: string): string {
  const match = url.match(/\.(jpe?g|png|webp|gif)/i);
  return match ? match[1].toLowerCase() : 'jpg';
}

export async function downloadListingImages(listingId: number): Promise<number> {
  const listing = await db.select().from(listings).where(eq(listings.id, listingId)).get();
  if (!listing) throw new Error(`Listing ${listingId} not found`);

  const images = await db.select()
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId));

  const pendingImages = images.filter((img) => img.downloadStatus === 'pending');
  if (pendingImages.length === 0) return 0;

  // Create directory for this listing
  const originalDir = path.join(DATA_DIR, 'originals', listing.platform, String(listingId));
  fs.mkdirSync(originalDir, { recursive: true });

  let downloaded = 0;
  for (let i = 0; i < pendingImages.length; i++) {
    const img = pendingImages[i];
    try {
      const response = await fetch(img.sourceUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': REFERERS[listing.platform] || '',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = getExtFromUrl(img.sourceUrl);
      const filename = `${i}.${ext}`;
      const filePath = path.join(originalDir, filename);
      const relativePath = path.join('originals', listing.platform, String(listingId), filename);

      fs.writeFileSync(filePath, buffer);

      await db.update(listingImages).set({
        localPathOriginal: relativePath,
        downloadStatus: 'downloaded',
        fileSizeBytes: buffer.length,
      }).where(eq(listingImages.id, img.id));

      downloaded++;
    } catch (err: any) {
      console.warn(`[downloader] Failed to download image ${img.sourceUrl}: ${err.message}`);
      await db.update(listingImages).set({
        downloadStatus: 'failed',
      }).where(eq(listingImages.id, img.id));
    }
  }

  return downloaded;
}

export async function downloadImagesForNewListings(listingIds: number[]): Promise<number> {
  let total = 0;
  for (const id of listingIds) {
    try {
      const count = await downloadListingImages(id);
      total += count;
    } catch (err: any) {
      console.error(`[downloader] Error downloading images for listing ${id}:`, err.message);
    }
  }
  console.log(`[downloader] Downloaded ${total} images for ${listingIds.length} listings`);
  return total;
}
