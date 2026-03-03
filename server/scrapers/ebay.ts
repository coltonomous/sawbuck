import { BaseScraper, type ScrapedListing, type ScraperConfig } from './base-scraper.js';
import { searchEbayBrowse } from '../lib/ebay.js';

export class EbayScraper extends BaseScraper {
  platform = 'ebay' as const;

  async scrape(config: ScraperConfig): Promise<ScrapedListing[]> {
    const items = await searchEbayBrowse({
      query: config.searchTerm,
      limit: 50,
      minPrice: config.minPrice,
      maxPrice: config.maxPrice,
    });

    return items.map((item) => ({
      externalId: item.itemId,
      platform: 'ebay' as const,
      url: item.itemWebUrl,
      title: item.title,
      askingPrice: item.price,
      location: item.itemLocation,
      imageUrls: item.imageUrl ? [item.imageUrl] : [],
    }));
  }
}
