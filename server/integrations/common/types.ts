export interface Region {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusMiles: number;
  clSubdomain: string | null;
}

export interface ScrapedCandidate {
  externalId: string;
  platform: string;
  url: string;
  title: string;
  askingPrice: number | null;
  location: string;
  imageUrls: string[];
  description?: string;
  latitude?: number;
  longitude?: number;
  postedAt?: string;
}

export interface EnrichResult {
  enriched: ScrapedCandidate[];
  removedIds: string[];
}

export interface PlatformIntegration {
  platform: string;
  discover(region: Region, page?: number): Promise<ScrapedCandidate[]>;
  enrich(candidates: ScrapedCandidate[]): Promise<EnrichResult>;
}
