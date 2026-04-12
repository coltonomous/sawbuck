export interface ScrapedCandidate {
  externalId: string;
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

export interface Integration {
  platform: string;
  ingest(): Promise<ScrapedCandidate[]>;
}
