import { discover, enrich } from './ingest.js';
import type { PlatformIntegration, Region, ScrapedCandidate, EnrichResult } from '../common/types.js';

export class OfferUpIntegration implements PlatformIntegration {
  platform = 'offerup';

  discover(region: Region, page?: number): Promise<ScrapedCandidate[]> {
    return discover(region, page);
  }

  enrich(candidates: ScrapedCandidate[]): Promise<EnrichResult> {
    return enrich(candidates);
  }
}

export { discover, enrich };
