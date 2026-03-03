import { BaseScraper, type ScrapedListing, type ScraperConfig } from './base-scraper.js';
import { withPage } from './browser-pool.js';

export class OfferUpScraper extends BaseScraper {
  platform = 'offerup' as const;

  async scrape(config: ScraperConfig): Promise<ScrapedListing[]> {
    const params = new URLSearchParams({ q: config.searchTerm });
    if (config.minPrice) params.set('PRICE_MIN', config.minPrice.toString());
    if (config.maxPrice) params.set('PRICE_MAX', config.maxPrice.toString());
    if (config.location) params.set('location', config.location);
    params.set('radius', '30');

    const searchUrl = `https://offerup.com/search?${params}`;
    console.log(`[offerup] Scraping: ${searchUrl}`);

    return withPage(async (page) => {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      // Wait for results to render
      await page.waitForSelector('a[href*="/item/detail/"]', { timeout: 8000 }).catch(() => {});

      // Try to click "Home & Garden" category filter
      try {
        const filterClicked = await page.evaluate(() => {
          const buttons = document.querySelectorAll('button, a, [role="button"], [role="tab"]');
          for (const btn of buttons) {
            const text = btn.textContent?.trim().toLowerCase() || '';
            if (text === 'home & garden' || text === 'furniture' || text === 'home and garden') {
              (btn as HTMLElement).click();
              return text;
            }
          }
          return null;
        });
        if (filterClicked) {
          console.log(`[offerup] Clicked category filter: ${filterClicked}`);
          await page.waitForTimeout(1500);
        }
      } catch {}

      // One scroll to load more
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);

      // Extract everything from search cards — no detail pages needed
      const listings = await page.evaluate(() => {
        const items: {
          externalId: string;
          platform: 'offerup';
          url: string;
          title: string;
          askingPrice?: number;
          location?: string;
          imageUrls: string[];
        }[] = [];

        document.querySelectorAll('a[href*="/item/detail/"]').forEach((anchor) => {
          const href = (anchor as HTMLAnchorElement).href;
          const idMatch = href.match(/\/item\/detail\/([a-f0-9-]+)/i);
          if (!idMatch) return;

          const title = anchor.getAttribute('title')?.trim()
            || anchor.querySelector('span, h2, h3')?.textContent?.trim()
            || '';

          let price: number | undefined;
          anchor.querySelectorAll('span').forEach((span) => {
            const text = span.textContent?.trim() || '';
            if (text.startsWith('$') && !price) {
              const num = parseFloat(text.replace(/[^0-9.]/g, ''));
              if (!isNaN(num)) price = num;
            }
          });

          const spans = anchor.querySelectorAll('span[class]');
          const lastSpan = spans[spans.length - 1];
          const loc = lastSpan?.textContent?.trim() || '';
          const isLocation = loc && !loc.startsWith('$') && loc !== title;

          const img = anchor.querySelector('img');
          const imageUrl = img?.src || '';

          if (title) {
            items.push({
              externalId: idMatch[1],
              platform: 'offerup',
              url: href.startsWith('http') ? href : `https://offerup.com${href}`,
              title,
              askingPrice: price,
              location: isLocation ? loc : undefined,
              imageUrls: imageUrl ? [imageUrl] : [],
            });
          }
        });

        return items;
      });

      console.log(`[offerup] Found ${listings.length} listings`);
      return listings;
    });
  }
}
