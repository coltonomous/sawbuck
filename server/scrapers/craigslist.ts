import { BaseScraper, type ScrapedListing, type ScraperConfig } from './base-scraper.js';
import { withPage, humanDelay } from './browser-pool.js';
import { stripKeywordSpam } from './detail-fetcher.js';
import { resolveClSubdomain, clDisplayLocation } from '../../shared/constants.js';
import logger from '../lib/logger.js';

export class CraigslistScraper extends BaseScraper {
  platform = 'craigslist' as const;

  async scrape(config: ScraperConfig): Promise<ScrapedListing[]> {
    const location = resolveClSubdomain(config.location || 'sfbay');
    const params = new URLSearchParams({ query: config.searchTerm });
    if (config.minPrice) params.set('min_price', config.minPrice.toString());
    if (config.maxPrice) params.set('max_price', config.maxPrice.toString());

    const cityName = clDisplayLocation(location);
    const searchUrl = `https://${location}.craigslist.org/search/fua?${params}`;
    logger.info({ searchUrl }, 'Scraping Craigslist');

    return withPage(async (page) => {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(humanDelay(1500, 3000));

      // Extract listings with images directly from search page
      const searchResults = await page.evaluate(() => {
        const items: { url: string; title: string; price: number | null; id: string; location: string; imageUrls: string[] }[] = [];

        document.querySelectorAll('.cl-search-result').forEach((el) => {
          const title = el.getAttribute('title') || '';
          const id = el.getAttribute('data-pid') || '';
          const link = el.querySelector('a[href*=".html"]') as HTMLAnchorElement | null;
          const priceEl = el.querySelector('.priceinfo, .price');
          const locationEl = el.querySelector('.meta .label, .location');

          // Grab images from the search card gallery
          const imageUrls: string[] = [];
          el.querySelectorAll('.swipe img, .gallery img').forEach((img) => {
            const src = (img as HTMLImageElement).src;
            if (src && src.startsWith('http')) {
              imageUrls.push(src.replace(/_\d+x\d+\./, '_600x450.'));
            }
          });

          if (title && link?.href) {
            const priceText = priceEl?.textContent?.replace(/[^0-9.]/g, '') || '';
            items.push({
              url: link.href,
              title,
              price: priceText ? parseFloat(priceText) : null,
              id: id || link.href.match(/\/(\d+)\.html/)?.[1] || link.href,
              location: locationEl?.textContent?.trim() || '',
              imageUrls: [...new Set(imageUrls)],
            });
          }
        });

        return items;
      });

      logger.info({ count: searchResults.length }, 'Craigslist search results found');

      // Only visit a few detail pages for descriptions (limit 5 for speed)
      const listings: ScrapedListing[] = [];

      for (let i = 0; i < searchResults.length; i++) {
        const result = searchResults[i];

        // Visit detail page for first 5 to get description, lat/lng, posted date
        if (i < 5) {
          try {
            await page.goto(result.url, { waitUntil: 'domcontentloaded', timeout: 10000 });
            await page.waitForTimeout(humanDelay(500, 1500));

            const detail = await page.evaluate(() => {
              const description = document.querySelector('#postingbody')?.textContent?.trim()
                ?.replace(/QR Code Link to This Post\s*/i, '')?.trim() || '';
              const timeEl = document.querySelector('.postinginfo .timeago, time.date');
              const postedAt = timeEl?.getAttribute('datetime') || timeEl?.getAttribute('title') || '';
              const mapEl = document.querySelector('#map');
              return {
                description,
                postedAt,
                lat: mapEl?.getAttribute('data-latitude') || '',
                lng: mapEl?.getAttribute('data-longitude') || '',
              };
            });

            listings.push({
              externalId: result.id,
              platform: 'craigslist',
              url: result.url,
              title: result.title,
              description: detail.description ? stripKeywordSpam(detail.description) : undefined,
              askingPrice: result.price ?? undefined,
              location: cityName,
              latitude: detail.lat ? parseFloat(detail.lat) : undefined,
              longitude: detail.lng ? parseFloat(detail.lng) : undefined,
              postedAt: detail.postedAt || undefined,
              imageUrls: result.imageUrls,
            });
            continue;
          } catch (err) {
            logger.warn({ url: result.url }, 'Craigslist detail page failed');
          }
        }

        // For the rest, use search page data only
        listings.push({
          externalId: result.id,
          platform: 'craigslist',
          url: result.url,
          title: result.title,
          askingPrice: result.price ?? undefined,
          location: cityName,
          imageUrls: result.imageUrls,
        });
      }

      logger.info({ total: listings.length, withDetails: Math.min(5, listings.length) }, 'Craigslist scrape complete');
      return listings;
    });
  }
}
