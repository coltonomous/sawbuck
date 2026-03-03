import { withPage } from './browser-pool.js';
import { db } from '../db/index.js';
import { comparables } from '../db/schema.js';
import { searchEbayBrowse } from '../lib/ebay.js';

export interface CompSearchParams {
  furnitureType?: string | null;
  furnitureStyle?: string | null;
  woodSpecies?: string | null;
  title?: string | null;
}

export interface EbayComp {
  title: string;
  soldPrice: number;
  soldDate?: string;
  url: string;
  condition?: string;
  source: 'ebay_sold' | 'ebay_active';
}

export interface EbayCompsResult {
  comps: EbayComp[];
  blocked: boolean;
}

function buildQueryVariants(params: CompSearchParams): string[] {
  const variants: string[] = [];
  const { furnitureType, furnitureStyle, woodSpecies, title } = params;

  // Most specific first
  if (furnitureStyle && furnitureType) {
    variants.push(`${furnitureStyle} ${furnitureType}`);
  }
  if (woodSpecies && furnitureType) {
    variants.push(`${woodSpecies} ${furnitureType}`);
  }
  if (furnitureType) {
    variants.push(furnitureType);
  }
  // Title keywords as last resort
  if (title) {
    const keywords = title.split(/\s+/).slice(0, 4).join(' ');
    if (keywords && !variants.includes(keywords)) {
      variants.push(keywords);
    }
  }

  return variants.filter(Boolean);
}

interface ScrapedSoldResult {
  comps: { title: string; price: number; date: string; url: string; condition: string }[];
  blocked: boolean;
}

async function scrapeSoldListings(query: string): Promise<ScrapedSoldResult> {
  const params = new URLSearchParams({
    _nkw: query,
    LH_Complete: '1',
    LH_Sold: '1',
    _sop: '13',
  });

  const searchUrl = `https://www.ebay.com/sch/i.html?${params}`;
  console.log(`[ebay-comps] Searching sold: ${searchUrl}`);

  return withPage(async (page) => {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500 + Math.random() * 1000);

    // Failure detection: check for blocks/CAPTCHAs/redirects
    const blocked = await page.evaluate(() => {
      const url = window.location.href;
      // Redirected away from search results
      if (!url.includes('/sch/')) return true;
      // CAPTCHA indicators
      if (document.querySelector('#captcha, .captcha, #g-recaptcha')) return true;
      // Results container exists but has 0 real items
      const container = document.querySelector('.srp-results');
      if (container) {
        const items = container.querySelectorAll('.s-item');
        const realItems = Array.from(items).filter(el => {
          const title = el.querySelector('.s-item__title')?.textContent?.trim();
          return title && title !== 'Shop on eBay';
        });
        if (realItems.length === 0) return false; // Genuinely zero results, not blocked
      }
      return false;
    });

    if (blocked) {
      console.warn(`[ebay-comps] Detected block/CAPTCHA for query "${query}"`);
      return { comps: [], blocked: true };
    }

    const comps = await page.evaluate(() => {
      const items: { title: string; price: number; date: string; url: string; condition: string }[] = [];

      document.querySelectorAll('.s-item').forEach((item) => {
        const titleEl = item.querySelector('.s-item__title');
        const priceEl = item.querySelector('.s-item__price');
        const linkEl = item.querySelector('.s-item__link');
        const dateEl = item.querySelector('.s-item__title--tagblock .POSITIVE, .s-item__ended-date');
        const conditionEl = item.querySelector('.SECONDARY_INFO');

        const title = titleEl?.textContent?.trim() || '';
        if (!title || title === 'Shop on eBay') return;

        const priceText = priceEl?.textContent || '';
        const priceMatch = priceText.match(/\$([0-9,]+\.?\d*)/);
        if (!priceMatch) return;
        const price = parseFloat(priceMatch[1].replace(',', ''));
        if (isNaN(price) || price === 0) return;

        const url = (linkEl as HTMLAnchorElement)?.href || '';
        const date = dateEl?.textContent?.trim() || '';
        const condition = conditionEl?.textContent?.trim() || '';

        items.push({ title, price, date, url, condition });
      });

      return items;
    });

    return { comps, blocked: false };
  });
}

export async function searchEbayComps(params: CompSearchParams, listingId?: number): Promise<EbayCompsResult> {
  const queries = buildQueryVariants(params);
  if (queries.length === 0) {
    return { comps: [], blocked: false };
  }

  // Try each query variant, stop at first with >= 3 results
  let soldComps: { title: string; price: number; date: string; url: string; condition: string }[] = [];
  let blocked = false;
  let usedQuery = queries[0];

  for (const query of queries) {
    try {
      const result = await scrapeSoldListings(query);
      blocked = result.blocked;

      if (result.blocked) {
        console.warn(`[ebay-comps] Blocked on query "${query}", will try Browse API fallback`);
        break;
      }

      if (result.comps.length >= 3) {
        soldComps = result.comps;
        usedQuery = query;
        console.log(`[ebay-comps] Found ${result.comps.length} sold results with query: "${query}"`);
        break;
      }

      // Keep best result so far
      if (result.comps.length > soldComps.length) {
        soldComps = result.comps;
        usedQuery = query;
      }
    } catch (err: any) {
      console.error(`[ebay-comps] Scraper error for "${query}":`, err.message);
    }
  }

  const results: EbayComp[] = [];

  // Store sold comps
  for (const comp of soldComps.slice(0, 30)) {
    const ebayComp: EbayComp = {
      title: comp.title,
      soldPrice: comp.price,
      soldDate: comp.date || undefined,
      url: comp.url,
      condition: comp.condition || undefined,
      source: 'ebay_sold',
    };

    if (listingId) {
      await db.insert(comparables).values({
        listingId,
        source: 'ebay_sold',
        sourceUrl: comp.url,
        title: comp.title,
        soldPrice: comp.price,
        soldDate: comp.date || null,
        condition: comp.condition || null,
        searchQuery: usedQuery,
      });
    }

    results.push(ebayComp);
  }

  // Browse API fallback: when blocked or 0 sold results
  if (blocked || soldComps.length === 0) {
    console.log(`[ebay-comps] Falling back to Browse API active listings (blocked=${blocked}, soldCount=${soldComps.length})`);
    const browseQuery = queries[0]; // Use most specific query

    try {
      const activeItems = await searchEbayBrowse({ query: browseQuery, limit: 20 });

      for (const item of activeItems) {
        const ebayComp: EbayComp = {
          title: item.title,
          soldPrice: item.price,
          url: item.itemWebUrl,
          condition: item.condition,
          source: 'ebay_active',
        };

        if (listingId) {
          await db.insert(comparables).values({
            listingId,
            source: 'ebay_active',
            sourceUrl: item.itemWebUrl,
            title: item.title,
            soldPrice: item.price,
            condition: item.condition || null,
            searchQuery: browseQuery,
          });
        }

        results.push(ebayComp);
      }
    } catch (err: any) {
      console.error(`[ebay-comps] Browse API fallback failed:`, err.message);
    }
  }

  return { comps: results, blocked };
}
