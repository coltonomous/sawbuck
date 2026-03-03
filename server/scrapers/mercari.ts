import { BaseScraper, type ScrapedListing, type ScraperConfig } from './base-scraper.js';
import { withPage } from './browser-pool.js';

export class MercariScraper extends BaseScraper {
  platform = 'mercari' as const;

  async scrape(config: ScraperConfig): Promise<ScrapedListing[]> {
    const params = new URLSearchParams({
      keyword: config.searchTerm,
      categoryIds: '15', // Home > Furniture
      status: 'on_sale',
      sortBy: 'created_time',
      order: 'desc',
    });
    if (config.minPrice) params.set('minPrice', config.minPrice.toString());
    if (config.maxPrice) params.set('maxPrice', config.maxPrice.toString());

    const searchUrl = `https://www.mercari.com/search/?${params}`;
    console.log(`[mercari] Scraping: ${searchUrl}`);

    return withPage(async (page) => {
      // Mercari uses Cloudflare — wait for challenge to pass
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

      // Wait for Cloudflare challenge to resolve (up to 15s)
      try {
        await page.waitForSelector('[data-testid="SearchResults"], [class*="SearchResults"], [class*="item"]', {
          timeout: 15000,
        });
      } catch {
        // Check if we hit a Cloudflare challenge page
        const pageContent = await page.content();
        if (pageContent.includes('challenge') || pageContent.includes('Cloudflare') || pageContent.includes('Just a moment')) {
          console.warn('[mercari] Cloudflare challenge detected — Mercari is currently blocking automated access. Disable this platform in Settings if it keeps failing.');
          return [];
        }
      }

      await page.waitForTimeout(2000 + Math.random() * 1000);

      // Scroll to load more
      for (let i = 0; i < 2; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500 + Math.random() * 500);
      }

      // Extract listings
      const results = await page.evaluate(() => {
        const items: ScrapedListing[] = [];

        // Try multiple selector strategies
        const cards = document.querySelectorAll(
          '[data-testid="ItemContainer"], [data-testid*="SearchResultItem"], a[href*="/item/"]'
        );

        const seen = new Set<string>();

        cards.forEach((card) => {
          const anchor = card.tagName === 'A' ? card : card.querySelector('a[href*="/item/"]');
          if (!anchor) return;

          const href = (anchor as HTMLAnchorElement).href;
          const idMatch = href.match(/\/item\/([a-zA-Z0-9]+)/);
          if (!idMatch || seen.has(idMatch[1])) return;
          seen.add(idMatch[1]);

          const title = card.querySelector(
            '[data-testid="ItemName"], [data-testid*="name"], [class*="ItemName"], [class*="itemName"]'
          )?.textContent?.trim()
            || card.querySelector('span, p')?.textContent?.trim()
            || '';

          const priceEl = card.querySelector(
            '[data-testid="ItemPrice"], [data-testid*="price"], [class*="ItemPrice"], [class*="price"]'
          );
          const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, '') || '';

          const img = card.querySelector('img');
          const imageUrl = img?.src || '';

          if (title && title.length > 2) {
            items.push({
              externalId: idMatch[1],
              platform: 'mercari' as const,
              url: href.startsWith('http') ? href : `https://www.mercari.com${href}`,
              title,
              askingPrice: priceText ? parseFloat(priceText) : undefined,
              imageUrls: imageUrl ? [imageUrl] : [],
            });
          }
        });

        return items;
      });

      console.log(`[mercari] Found ${results.length} results from search page`);

      // Visit detail pages for more images and description (limit to 12 — Mercari is slower)
      const listings: ScrapedListing[] = [];
      const toVisit = results.slice(0, 12);

      for (const result of toVisit) {
        try {
          await page.goto(result.url, { waitUntil: 'networkidle', timeout: 20000 });
          await page.waitForTimeout(1200 + Math.random() * 800);

          const detail = await page.evaluate(() => {
            const description = document.querySelector(
              '[data-testid="ItemDescription"], [data-testid*="description"], [class*="ItemDescription"]'
            )?.textContent?.trim() || '';

            const images: string[] = [];
            document.querySelectorAll(
              '[data-testid*="ItemImage"] img, [class*="ItemPhotos"] img, [class*="gallery"] img, [class*="carousel"] img'
            ).forEach((img) => {
              const src = (img as HTMLImageElement).src;
              if (src && !src.includes('placeholder')) images.push(src);
            });

            if (images.length === 0) {
              document.querySelectorAll('img').forEach((img) => {
                if (img.naturalWidth > 200 && img.src && !img.src.includes('avatar') && !img.src.includes('logo')) {
                  images.push(img.src);
                }
              });
            }

            const seller = document.querySelector(
              '[data-testid*="SellerName"], [class*="SellerName"], [class*="seller"]'
            )?.textContent?.trim() || '';

            const condition = document.querySelector(
              '[data-testid*="Condition"], [class*="Condition"]'
            )?.textContent?.trim() || '';

            return { description, images, seller, condition };
          });

          listings.push({
            ...result,
            description: detail.description
              ? `${detail.description}${detail.condition ? `\nCondition: ${detail.condition}` : ''}`
              : undefined,
            sellerName: detail.seller || undefined,
            imageUrls: detail.images.length > 0 ? [...new Set(detail.images)] : result.imageUrls,
          });
        } catch (err) {
          console.warn(`[mercari] Failed detail page: ${result.url}`, err);
          listings.push(result);
        }
      }

      console.log(`[mercari] Scraped ${listings.length} full listings`);
      return listings;
    });
  }
}
