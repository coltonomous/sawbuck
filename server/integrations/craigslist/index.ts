import { discover, enrich, type EnrichResult } from './ingest.js';
import type { Integration } from '../common/types.js';

export const craigslistIntegration: Integration = {
  platform: 'craigslist',
  ingest: discover,
};

export { discover, enrich, type EnrichResult };
