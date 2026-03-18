import { BaseScraper, type ScrapedListing, type ScraperConfig } from './base-scraper.js';
import { withPage, humanDelay } from './browser-pool.js';

export class FacebookScraper extends BaseScraper {
  platform = 'facebook' as const;

  async scrape(config: ScraperConfig): Promise<ScrapedListing[]> {
    const encodedQuery = encodeURIComponent(config.searchTerm);

    // Build Facebook Marketplace search URL
    // Category 702 = "Furniture" under Home & Garden
    let searchUrl = `https://www.facebook.com/marketplace/search/?query=${encodedQuery}&category_id=702`;
    if (config.minPrice) searchUrl += `&minPrice=${config.minPrice}`;
    if (config.maxPrice) searchUrl += `&maxPrice=${config.maxPrice}`;

    console.log(`[facebook] Scraping: ${searchUrl}`);

    return withPage(async (page) => {
      // Facebook is heavy on JS — wait for network to settle
      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(humanDelay(2000, 4000));

      // Dismiss login modal if it appears (FB nags non-logged-in users)
      await page.evaluate(() => {
        // Close button on login overlay
        const closeButtons = document.querySelectorAll('[aria-label="Close"], [aria-label="close"]');
        for (const btn of closeButtons) {
          (btn as HTMLElement).click();
        }
      });
      await page.waitForTimeout(humanDelay(400, 800));

      // Scroll once to trigger lazy-loading of more results
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(humanDelay(1200, 2500));

      const listings = await page.evaluate(() => {
        const items: {
          externalId: string;
          url: string;
          title: string;
          askingPrice?: number;
          location?: string;
          imageUrls: string[];
        }[] = [];

        // FB Marketplace renders listing cards as links to /marketplace/item/<id>
        document.querySelectorAll('a[href*="/marketplace/item/"]').forEach((anchor) => {
          const href = (anchor as HTMLAnchorElement).href;
          const idMatch = href.match(/\/marketplace\/item\/(\d+)/);
          if (!idMatch) return;
          const externalId = idMatch[1];

          // Skip if we already captured this listing (FB can duplicate links)
          if (items.some(i => i.externalId === externalId)) return;

          // Walk up to the card container to find siblings with text/images
          const card = anchor.closest('[class]') || anchor;

          // Extract title — usually the first prominent text span
          const spans = card.querySelectorAll('span');
          let title = '';
          let price: number | undefined;
          let location = '';

          for (const span of spans) {
            const text = span.textContent?.trim() || '';
            if (!text) continue;

            // Price: "$123" or "$1,234"
            if (!price && /^\$[\d,.]+$/.test(text)) {
              price = parseFloat(text.replace(/[^0-9.]/g, ''));
              continue;
            }

            // Title: first non-price span with reasonable length
            if (!title && text.length > 5 && text.length < 200 && !text.startsWith('$')) {
              title = text;
              continue;
            }

            // Location: shorter text after title, often city name
            if (title && !location && text.length > 2 && text.length < 60 && !text.startsWith('$') && text !== title) {
              location = text;
            }
          }

          // Extract image
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

      // Override location from config if provided (FB doesn't always show it on cards)
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
