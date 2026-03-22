import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { BaseScraper, type ScrapedListing, type ScraperConfig } from './base-scraper.js';
import { withPage, humanDelay } from './browser-pool.js';
import { getSystemBrowserCookies, type BrowserCookie } from '../lib/browser-cookies.js';

const COOKIES_PATH = join(process.cwd(), 'data', 'fb-cookies.json');

function hasRequiredCookies(cookies: BrowserCookie[]): boolean {
  return cookies.some((c) => c.name === 'c_user' && c.value) &&
    cookies.some((c) => c.name === 'xs' && c.value);
}

/** Try system browser cookies first, then data/fb-cookies.json. */
function loadCookies(): BrowserCookie[] | null {
  const system = getSystemBrowserCookies('facebook.com');
  if (system && hasRequiredCookies(system)) return system;

  if (!existsSync(COOKIES_PATH)) return null;

  try {
    const cookies = JSON.parse(readFileSync(COOKIES_PATH, 'utf-8'));
    if (!Array.isArray(cookies) || cookies.length === 0) return null;

    const normalized: BrowserCookie[] = cookies.map((c: any) => ({
      name: c.name,
      value: c.value,
      domain: c.domain || '.facebook.com',
      path: c.path || '/',
    }));

    if (!hasRequiredCookies(normalized)) {
      console.warn('[facebook] fb-cookies.json missing c_user or xs cookies');
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

export class FacebookScraper extends BaseScraper {
  platform = 'facebook' as const;

  async scrape(config: ScraperConfig): Promise<ScrapedListing[]> {
    const cookies = loadCookies();
    if (!cookies) {
      console.warn('[facebook] No session found — log into Facebook in Chrome/Firefox, or export cookies to data/fb-cookies.json');
      return [];
    }

    const encodedQuery = encodeURIComponent(config.searchTerm);
    let searchUrl = `https://www.facebook.com/marketplace/search/?query=${encodedQuery}&category_id=702`;
    if (config.minPrice) searchUrl += `&minPrice=${config.minPrice}`;
    if (config.maxPrice) searchUrl += `&maxPrice=${config.maxPrice}`;

    console.log(`[facebook] Scraping: ${searchUrl}`);

    return withPage(async (page) => {
      await page.context().addCookies(cookies);
      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(humanDelay(2000, 4000));

      if (page.url().includes('/login')) {
        console.warn('[facebook] Session expired — log into Facebook again and retry');
        return [];
      }

      // Dismiss modals
      await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>('[aria-label="Close"], [aria-label="close"]')
          .forEach((btn) => btn.click());
      });
      await page.waitForTimeout(humanDelay(400, 800));

      for (let i = 0; i < 2; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(humanDelay(1200, 2500));
      }

      const listings = await page.evaluate(() => {
        const items: {
          externalId: string;
          url: string;
          title: string;
          askingPrice?: number;
          location?: string;
          imageUrls: string[];
        }[] = [];

        document.querySelectorAll('a[href*="/marketplace/item/"]').forEach((anchor) => {
          const href = (anchor as HTMLAnchorElement).href;
          const idMatch = href.match(/\/marketplace\/item\/(\d+)/);
          if (!idMatch) return;
          const externalId = idMatch[1];
          if (items.some((i) => i.externalId === externalId)) return;

          const card = anchor.closest('[class]') || anchor;
          const spans = card.querySelectorAll('span');
          let title = '';
          let price: number | undefined;
          let location = '';

          for (const span of spans) {
            const text = span.textContent?.trim() || '';
            if (!text) continue;

            if (!price && /^\$[\d,.]+$/.test(text)) {
              price = parseFloat(text.replace(/[^0-9.]/g, ''));
              continue;
            }
            if (!title && text.length > 5 && text.length < 200 && !text.startsWith('$')) {
              title = text;
              continue;
            }
            if (title && !location && text.length > 2 && text.length < 60 && !text.startsWith('$') && text !== title) {
              location = text;
            }
          }

          const img = card.querySelector('img');
          const imageUrl = img?.src || '';
          const imageUrls = imageUrl && !imageUrl.includes('data:') ? [imageUrl] : [];

          if (title) {
            items.push({
              externalId,
              url: `https://www.facebook.com/marketplace/item/${externalId}`,
              title,
              askingPrice: price,
              location: location || undefined,
              imageUrls,
            });
          }
        });

        return items;
      });

      const results: ScrapedListing[] = listings.map((item) => ({
        ...item,
        platform: 'facebook' as const,
        location: item.location || config.location,
      }));

      console.log(`[facebook] Found ${results.length} listings`);
      return results;
    });
  }
}
