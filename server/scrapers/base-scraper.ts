export interface ScrapedListing {
  externalId: string;
  platform: 'craigslist' | 'offerup' | 'mercari' | 'ebay';
  url: string;
  title: string;
  description?: string;
  askingPrice?: number;
  location?: string;
  latitude?: number;
  longitude?: number;
  sellerName?: string;
  postedAt?: string;
  imageUrls: string[];
}

export interface ScraperConfig {
  searchTerm: string;
  location?: string;
  minPrice?: number;
  maxPrice?: number;
  category?: string;
}

export abstract class BaseScraper {
  abstract platform: 'craigslist' | 'offerup' | 'mercari' | 'ebay';
  abstract scrape(config: ScraperConfig): Promise<ScrapedListing[]>;
}
