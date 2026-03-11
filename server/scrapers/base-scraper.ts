import type { Platform } from '../../shared/constants.js';

export interface ScrapedListing {
  externalId: string;
  platform: Platform;
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
  abstract platform: Platform;
  abstract scrape(config: ScraperConfig): Promise<ScrapedListing[]>;
}
