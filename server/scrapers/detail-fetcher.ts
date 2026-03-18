import { db } from '../db/index.js';
import { listings, listingImages } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { withPage, humanDelay } from './browser-pool.js';
import { CL_DISPLAY_NAMES } from '../../shared/constants.js';

/**
 * Strip SEO keyword spam from Craigslist descriptions.
 * Dealers stuff their posts with walls of keywords after a stock code (e.g. "SV1767\nmcm eames era...").
 * Pattern: last paragraph starting with a short code, followed by 200+ chars of space-separated keywords.
 */
export function stripKeywordSpam(description: string): string {
  // Remove trailing paragraph that starts with a stock/reference code followed by keyword spam
  const cleaned = description.replace(/\n\n\s*[A-Z]{1,4}\d{2,5}\s*\n[\s\S]*$/, '');
  if (cleaned.length < description.length) return cleaned.trim();

  // Also catch keyword blocks without a stock code — long final paragraph (500+ chars) with very few newlines
  const parts = description.split(/\n\n/);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].trim();
    const newlineCount = (last.match(/\n/g) || []).length;
    // Keyword spam: 500+ chars with < 3 newlines and mostly lowercase single words
    if (last.length > 500 && newlineCount < 3) {
      parts.pop();
      return parts.join('\n\n').trim();
    }
  }

  return description;
}

interface ListingRow {
  id: number;
  platform: string;
  url: string;
  [key: string]: any;
}

export async function fetchListingDetails(listing: ListingRow): Promise<void> {
  console.log(`[detail-fetcher] Fetching details for listing ${listing.id}: ${listing.url}`);

  await withPage(async (page) => {
    await page.goto(listing.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(humanDelay(1200, 2500));

    if (listing.platform === 'craigslist') {
      await fetchCraigslistDetail(page, listing);
    } else if (listing.platform === 'offerup') {
      await fetchOfferUpDetail(page, listing);
    } else if (listing.platform === 'mercari') {
      await fetchMercariDetail(page, listing);
    } else if (listing.platform === 'facebook') {
      await fetchFacebookDetail(page, listing);
    }
  });
}

function locationFromCraigslistUrl(url: string): string | null {
  const match = url.match(/^https?:\/\/([^.]+)\.craigslist\.org/);
  if (!match) return null;
  const sub = match[1];
  return CL_DISPLAY_NAMES[sub] || sub.charAt(0).toUpperCase() + sub.slice(1);
}

async function fetchCraigslistDetail(page: any, listing: ListingRow) {
  const detail = await page.evaluate(() => {
    const title = document.querySelector('#titletextonly')?.textContent?.trim() || '';
    const priceText = document.querySelector('.price')?.textContent?.replace(/[^0-9.]/g, '') || '';

    const description = document.querySelector('#postingbody')?.textContent?.trim()
      ?.replace(/QR Code Link to This Post\s*/i, '')?.trim() || '';

    const images: string[] = [];

    // Rendered img elements
    document.querySelectorAll('.swipe img, .gallery img, .slide img').forEach((el: any) => {
      const src = el.src;
      if (src && src.startsWith('http') && !src.includes('data:')) {
        images.push(src.replace(/_\d+x\d+\./, '_600x450.'));
      }
    });

    // Fallback: parse imageConfig
    if (images.length === 0) {
      for (const script of document.querySelectorAll('script')) {
        const match = (script.textContent || '').match(/'imageConfig'\s*:\s*(\{[\s\S]*?\})\s*,\s*'/);
        if (match) {
          try {
            const config = JSON.parse(match[1]);
            const pid = window.location.pathname.match(/\/(\d+)\.html/)?.[1];
            for (const [idx, data] of Object.entries(config) as [string, any][]) {
              const host = data.hostname || 'https://images.craigslist.org';
              if (pid) images.push(`${host}/${pid}_${idx}_600x450.jpg`);
            }
          } catch {}
          break;
        }
      }
    }

    const timeEl = document.querySelector('.postinginfo .timeago, time.date');
    const postedAt = timeEl?.getAttribute('datetime') || timeEl?.getAttribute('title') || '';
    const mapEl = document.querySelector('#map');

    return {
      title,
      price: priceText ? parseFloat(priceText) : null,
      description,
      images: [...new Set(images)],
      postedAt,
      lat: mapEl?.getAttribute('data-latitude') || '',
      lng: mapEl?.getAttribute('data-longitude') || '',
    };
  });

  // Update listing with extracted detail fields
  const updates: Record<string, any> = {};
  if (detail.title && (!listing.title || listing.title.startsWith('(imported'))) updates.title = detail.title;
  if (detail.price != null && !listing.askingPrice) updates.askingPrice = detail.price;
  if (detail.description) updates.description = stripKeywordSpam(detail.description);
  if (detail.postedAt) updates.postedAt = detail.postedAt;
  if (detail.lat) updates.latitude = parseFloat(detail.lat);
  if (detail.lng) updates.longitude = parseFloat(detail.lng);
  if (!listing.location || listing.location === 'google map') {
    const city = locationFromCraigslistUrl(listing.url);
    if (city) updates.location = city;
  }

  if (Object.keys(updates).length > 0) {
    await db.update(listings).set(updates).where(eq(listings.id, listing.id));
  }

  // Insert images if we don't have any
  const existing = await db.select().from(listingImages).where(eq(listingImages.listingId, listing.id));
  if (existing.length === 0 && detail.images.length > 0) {
    for (let i = 0; i < detail.images.length; i++) {
      await db.insert(listingImages).values({
        listingId: listing.id,
        sourceUrl: detail.images[i],
        isPrimary: i === 0,
      });
    }
  }

  console.log(`[detail-fetcher] CL listing ${listing.id}: ${detail.description?.length || 0} chars, ${detail.images.length} images`);
}

async function fetchOfferUpDetail(page: any, listing: ListingRow) {
  // Wait for content to render
  await page.waitForSelector('img', { timeout: 5000 }).catch(() => {});

  const detail = await page.evaluate(() => {
    let title = '';
    let price: number | null = null;
    let desc = '';
    let location = '';
    const images: string[] = [];

    // Strategy 1: JSON-LD structured data (most reliable if present)
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent || '');
        if (data.name) title = data.name;
        if (data.offers?.price) price = parseFloat(data.offers.price);
        if (data.description) desc = data.description;
        if (data.image) {
          const imgs = Array.isArray(data.image) ? data.image : [data.image];
          imgs.forEach((i: any) => {
            const url = typeof i === 'string' ? i : i?.url;
            if (url) images.push(url);
          });
        }
        if (data.availableAtOrFrom?.address?.addressLocality) {
          location = data.availableAtOrFrom.address.addressLocality;
          if (data.availableAtOrFrom.address.addressRegion) {
            location += ', ' + data.availableAtOrFrom.address.addressRegion;
          }
        }
      } catch {}
    }

    // Strategy 2: Open Graph / meta tags
    if (!title) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) title = ogTitle.getAttribute('content')?.replace(/\s*[-–|].*/,'') || '';
    }
    if (!desc) {
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) desc = ogDesc.getAttribute('content') || '';
    }
    if (images.length === 0) {
      const ogImage = document.querySelector('meta[property="og:image"]');
      if (ogImage) {
        const url = ogImage.getAttribute('content');
        if (url) images.push(url);
      }
    }

    // Strategy 3: DOM extraction for price if still missing
    if (price == null) {
      document.querySelectorAll('span').forEach((el) => {
        if (price != null) return;
        const text = el.textContent?.trim() || '';
        const m = text.match(/^\$([0-9,]+(?:\.\d{2})?)$/);
        if (m) price = parseFloat(m[1].replace(/,/g, ''));
      });
    }

    // Strategy 4: DOM extraction for images (supplement with page images)
    if (images.length < 2) {
      document.querySelectorAll('img').forEach((img: any) => {
        const src = img.src;
        if (src && src.includes('offerup') && !src.includes('avatar') && !src.includes('logo')) {
          if (img.naturalWidth > 100 || img.width > 100) {
            const large = src.replace(/\/\d+x\d+\//, '/600x600/');
            images.push(large);
          }
        }
      });
    }

    // Extract location from "Posted X ago in City, ST" if not found above
    // Only check leaf-level elements to avoid grabbing entire page text
    if (!location) {
      document.querySelectorAll('span').forEach((el: any) => {
        if (location) return;
        const text = el.textContent?.trim() || '';
        // Match "Posted 6 months ago in Niagara Falls, NY" — location is city + optional state
        const locMatch = text.match(/Posted .+? in ([A-Za-z\s]+,\s*[A-Z]{2})/);
        if (locMatch) {
          location = locMatch[1].trim();
        } else {
          // Try without state: "Posted 3 days ago in Toronto, ON"
          const locMatch2 = text.match(/Posted .+? in ([A-Za-z\s,.]+)/);
          if (locMatch2) {
            // Take just the location part — stop at any non-location character
            const raw = locMatch2[1].trim();
            // Trim to just "City, XX" pattern (max ~40 chars, no junk)
            if (raw.length < 50) location = raw;
          }
        }
      });
    }

    return { title, price, description: desc, images: [...new Set(images)], location };
  });

  const updates: Record<string, any> = {};
  if (detail.title && (!listing.title || listing.title.startsWith('(imported'))) updates.title = detail.title;
  if (detail.price != null && !listing.askingPrice) updates.askingPrice = detail.price;
  if (detail.description) updates.description = detail.description;
  if (detail.location) updates.location = detail.location;

  if (Object.keys(updates).length > 0) {
    await db.update(listings).set(updates).where(eq(listings.id, listing.id));
  }

  const existing = await db.select().from(listingImages).where(eq(listingImages.listingId, listing.id));
  if (existing.length === 0 && detail.images.length > 0) {
    for (let i = 0; i < detail.images.length; i++) {
      await db.insert(listingImages).values({
        listingId: listing.id,
        sourceUrl: detail.images[i],
        isPrimary: i === 0,
      });
    }
  }

  console.log(`[detail-fetcher] OU listing ${listing.id}: ${detail.description?.length || 0} chars, ${detail.images.length} images`);
}

async function fetchMercariDetail(page: any, listing: ListingRow) {
  await page.waitForSelector('img', { timeout: 5000 }).catch(() => {});

  const detail = await page.evaluate(() => {
    let title = '';
    let price: number | null = null;

    // JSON-LD structured data
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent || '');
        if (data.name) title = data.name;
        if (data.offers?.price) price = parseFloat(data.offers.price);
      } catch {}
    }

    // Fallback: OG title
    if (!title) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) title = ogTitle.getAttribute('content')?.replace(/\s*[-–|].*/,'') || '';
    }

    // Fallback: price from DOM
    if (price == null) {
      const priceEl = document.querySelector('[data-testid*="price"], [class*="price"]');
      const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, '') || '';
      if (priceText) price = parseFloat(priceText);
    }

    const description = document.querySelector(
      '[data-testid*="description"], [class*="description"]'
    )?.textContent?.trim() || '';

    const images: string[] = [];
    document.querySelectorAll('img').forEach((img: any) => {
      const src = img.src;
      if (src && src.includes('mercari') && img.width > 100 && !src.includes('avatar')) {
        images.push(src);
      }
    });

    return { title, price, description, images: [...new Set(images)] };
  });

  const updates: Record<string, any> = {};
  if (detail.title && (!listing.title || listing.title.startsWith('(imported'))) updates.title = detail.title;
  if (detail.price != null && !listing.askingPrice) updates.askingPrice = detail.price;
  if (detail.description) updates.description = detail.description;

  if (Object.keys(updates).length > 0) {
    await db.update(listings).set(updates).where(eq(listings.id, listing.id));
  }

  const existing = await db.select().from(listingImages).where(eq(listingImages.listingId, listing.id));
  if (existing.length === 0 && detail.images.length > 0) {
    for (let i = 0; i < detail.images.length; i++) {
      await db.insert(listingImages).values({
        listingId: listing.id,
        sourceUrl: detail.images[i],
        isPrimary: i === 0,
      });
    }
  }

  console.log(`[detail-fetcher] Mercari listing ${listing.id}: ${detail.description?.length || 0} chars, ${detail.images.length} images`);
}

async function fetchFacebookDetail(page: any, listing: ListingRow) {
  // Facebook item pages are JS-heavy — wait for content to render
  await page.waitForSelector('img', { timeout: 8000 }).catch(() => {});

  // Dismiss login modal if it appears
  await page.evaluate(() => {
    const closeButtons = document.querySelectorAll('[aria-label="Close"], [aria-label="close"]');
    for (const btn of closeButtons) {
      (btn as HTMLElement).click();
    }
  });
  await page.waitForTimeout(humanDelay(400, 900));

  const detail = await page.evaluate(() => {
    let title = '';
    let price: number | null = null;
    let description = '';
    let location = '';
    const images: string[] = [];

    // Strategy 1: JSON-LD structured data
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent || '');
        if (data.name) title = data.name;
        if (data.offers?.price) price = parseFloat(data.offers.price);
        if (data.description) description = data.description;
        if (data.image) {
          const imgs = Array.isArray(data.image) ? data.image : [data.image];
          imgs.forEach((i: any) => {
            const url = typeof i === 'string' ? i : i?.url;
            if (url) images.push(url);
          });
        }
        if (data.availableAtOrFrom?.address?.addressLocality) {
          location = data.availableAtOrFrom.address.addressLocality;
          if (data.availableAtOrFrom.address.addressRegion) {
            location += ', ' + data.availableAtOrFrom.address.addressRegion;
          }
        }
      } catch {}
    }

    // Strategy 2: Open Graph meta tags
    if (!title) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) title = ogTitle.getAttribute('content')?.replace(/\s*[-–|].*/,'') || '';
    }
    if (!description) {
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) description = ogDesc.getAttribute('content') || '';
    }
    if (images.length === 0) {
      const ogImage = document.querySelector('meta[property="og:image"]');
      if (ogImage) {
        const url = ogImage.getAttribute('content');
        if (url) images.push(url);
      }
    }

    // Strategy 3: DOM price extraction — FB shows price in a prominent span
    if (price == null) {
      document.querySelectorAll('span').forEach((el) => {
        if (price != null) return;
        const text = el.textContent?.trim() || '';
        const m = text.match(/^\$([0-9,]+(?:\.\d{2})?)$/);
        if (m) price = parseFloat(m[1].replace(/,/g, ''));
      });
    }

    // Strategy 4: Extract from DOM — FB detail pages show images in a carousel
    if (images.length < 2) {
      document.querySelectorAll('img').forEach((img) => {
        const src = img.src;
        if (
          src && src.startsWith('http') && !src.includes('data:') &&
          !src.includes('emoji') && !src.includes('static') &&
          (img.naturalWidth > 200 || img.width > 200)
        ) {
          images.push(src);
        }
      });
    }

    // Extract description from the detail section if not found via structured data
    if (!description) {
      // FB often puts the seller description in a span under the listing details
      const allSpans = document.querySelectorAll('span');
      for (const span of allSpans) {
        const text = span.textContent?.trim() || '';
        // Descriptions are typically 20-5000 chars, not single words
        if (text.length > 30 && text.length < 5000 && !text.includes('See more') && !text.includes('Log in')) {
          description = text;
          break;
        }
      }
    }

    // Extract location from "Listed X ago in City, ST" pattern
    if (!location) {
      const allSpans = document.querySelectorAll('span');
      for (const span of allSpans) {
        const text = span.textContent?.trim() || '';
        const locMatch = text.match(/(?:Listed|posted).+?in\s+(.+)/i);
        if (locMatch && locMatch[1].length < 60) {
          location = locMatch[1].trim();
          break;
        }
      }
    }

    return { title, price, description, images: [...new Set(images)], location };
  });

  const updates: Record<string, any> = {};
  if (detail.title && (!listing.title || listing.title.startsWith('(imported'))) updates.title = detail.title;
  if (detail.price != null && !listing.askingPrice) updates.askingPrice = detail.price;
  if (detail.description) updates.description = detail.description;
  if (detail.location) updates.location = detail.location;

  if (Object.keys(updates).length > 0) {
    await db.update(listings).set(updates).where(eq(listings.id, listing.id));
  }

  const existing = await db.select().from(listingImages).where(eq(listingImages.listingId, listing.id));
  if (existing.length === 0 && detail.images.length > 0) {
    for (let i = 0; i < detail.images.length; i++) {
      await db.insert(listingImages).values({
        listingId: listing.id,
        sourceUrl: detail.images[i],
        isPrimary: i === 0,
      });
    }
  }

  console.log(`[detail-fetcher] FB listing ${listing.id}: ${detail.description?.length || 0} chars, ${detail.images.length} images`);
}
