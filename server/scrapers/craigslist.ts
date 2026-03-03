import { BaseScraper, type ScrapedListing, type ScraperConfig } from './base-scraper.js';
import { withPage } from './browser-pool.js';
import { stripKeywordSpam } from './detail-fetcher.js';

// Common city/area names → Craigslist subdomain
const CL_SUBDOMAINS: Record<string, string> = {
  'seattle': 'seattle', 'kent': 'seattle', 'tacoma': 'seattle', 'bellevue': 'seattle', 'renton': 'seattle', 'everett': 'seattle', 'redmond': 'seattle', 'kirkland': 'seattle', 'olympia': 'seattle', 'auburn': 'seattle',
  'portland': 'portland', 'beaverton': 'portland', 'hillsboro': 'portland', 'gresham': 'portland',
  'sf': 'sfbay', 'sfbay': 'sfbay', 'san francisco': 'sfbay', 'oakland': 'sfbay', 'san jose': 'sfbay', 'berkeley': 'sfbay', 'fremont': 'sfbay', 'palo alto': 'sfbay',
  'la': 'losangeles', 'los angeles': 'losangeles', 'losangeles': 'losangeles', 'pasadena': 'losangeles', 'long beach': 'losangeles', 'glendale': 'losangeles', 'burbank': 'losangeles',
  'san diego': 'sandiego', 'sandiego': 'sandiego',
  'sacramento': 'sacramento',
  'phoenix': 'phoenix', 'mesa': 'phoenix', 'scottsdale': 'phoenix', 'tempe': 'phoenix', 'chandler': 'phoenix', 'gilbert': 'phoenix',
  'denver': 'denver', 'aurora': 'denver', 'boulder': 'boulder',
  'chicago': 'chicago', 'evanston': 'chicago', 'naperville': 'chicago',
  'new york': 'newyork', 'newyork': 'newyork', 'nyc': 'newyork', 'brooklyn': 'newyork', 'queens': 'newyork', 'manhattan': 'newyork', 'bronx': 'newyork',
  'austin': 'austin', 'houston': 'houston', 'dallas': 'dallas', 'san antonio': 'sanantonio',
  'atlanta': 'atlanta', 'miami': 'miami', 'tampa': 'tampa', 'orlando': 'orlando',
  'boston': 'boston', 'detroit': 'detroit', 'minneapolis': 'minneapolis', 'dc': 'washingtondc', 'washington': 'washingtondc', 'washington dc': 'washingtondc',
  'philadelphia': 'philadelphia', 'philly': 'philadelphia', 'pittsburgh': 'pittsburgh',
  'las vegas': 'lasvegas', 'vegas': 'lasvegas', 'reno': 'reno',
  'nashville': 'nashville', 'memphis': 'memphis', 'charlotte': 'charlotte', 'raleigh': 'raleigh',
  'columbus': 'columbus', 'cincinnati': 'cincinnati', 'cleveland': 'cleveland',
  'salt lake': 'saltlakecity', 'salt lake city': 'saltlakecity', 'slc': 'saltlakecity',
  'indianapolis': 'indianapolis', 'milwaukee': 'milwaukee', 'kansas city': 'kansascity',
  'st louis': 'stlouis', 'stlouis': 'stlouis',
  'honolulu': 'honolulu', 'anchorage': 'anchorage',
};

function resolveSubdomain(location: string): string {
  const normalized = location.toLowerCase().trim();
  return CL_SUBDOMAINS[normalized] || normalized;
}

export class CraigslistScraper extends BaseScraper {
  platform = 'craigslist' as const;

  async scrape(config: ScraperConfig): Promise<ScrapedListing[]> {
    const location = resolveSubdomain(config.location || 'sfbay');
    const params = new URLSearchParams({ query: config.searchTerm });
    if (config.minPrice) params.set('min_price', config.minPrice.toString());
    if (config.maxPrice) params.set('max_price', config.maxPrice.toString());

    const searchUrl = `https://${location}.craigslist.org/search/fua?${params}`;
    console.log(`[craigslist] Scraping: ${searchUrl}`);

    return withPage(async (page) => {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500 + Math.random() * 1000);

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

      console.log(`[craigslist] Found ${searchResults.length} results on search page`);

      // Only visit a few detail pages for descriptions (limit 5 for speed)
      const listings: ScrapedListing[] = [];

      for (let i = 0; i < searchResults.length; i++) {
        const result = searchResults[i];

        // Visit detail page for first 5 to get description, lat/lng, posted date
        if (i < 5) {
          try {
            await page.goto(result.url, { waitUntil: 'domcontentloaded', timeout: 10000 });
            await page.waitForTimeout(500);

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
              location: result.location || undefined,
              latitude: detail.lat ? parseFloat(detail.lat) : undefined,
              longitude: detail.lng ? parseFloat(detail.lng) : undefined,
              postedAt: detail.postedAt || undefined,
              imageUrls: result.imageUrls,
            });
            continue;
          } catch (err) {
            console.warn(`[craigslist] Detail page failed: ${result.url}`);
          }
        }

        // For the rest, use search page data only
        listings.push({
          externalId: result.id,
          platform: 'craigslist',
          url: result.url,
          title: result.title,
          askingPrice: result.price ?? undefined,
          location: result.location || undefined,
          imageUrls: result.imageUrls,
        });
      }

      console.log(`[craigslist] Scraped ${listings.length} listings (${Math.min(5, listings.length)} with details)`);
      return listings;
    });
  }
}
