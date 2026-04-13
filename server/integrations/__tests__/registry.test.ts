import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
let mockPlatformSettings: { platform: string; enabled: boolean }[] = [];
let mockRegions: { id: number; name: string; latitude: number; longitude: number; radiusMiles: number; clSubdomain: string | null; enabled: boolean }[] = [];

vi.mock('../../db/index.js', () => {
  const makeSelectChain = (data: unknown[]) => {
    const chain: any = {};
    for (const m of ['select', 'from', 'orderBy']) {
      chain[m] = () => chain;
    }
    chain.where = () => {
      chain._filtered = true;
      return chain;
    };
    chain.then = (resolve: any) => resolve(chain._filtered ? data.filter((d: any) => d.enabled !== false) : data);
    chain.catch = () => chain;
    return chain;
  };

  return {
    db: new Proxy({}, {
      get(_t, prop) {
        if (prop === 'select') return () => ({
          from: (table: any) => {
            const data = table === 'platform_settings' ? mockPlatformSettings : mockRegions;
            const chain = makeSelectChain(data);
            return chain;
          },
        });
        if (prop === 'insert') return () => ({ values: () => ({ onConflictDoNothing: () => ({}) }) });
        return () => ({});
      },
    }),
  };
});

vi.mock('../../db/schema.js', () => ({
  platformSettings: 'platform_settings',
  regions: 'regions',
}));

vi.mock('../../lib/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../agents/config.js', () => ({
  agentConfig: { targetCity: 'seattle' },
}));

import { getIntegration, getEnabledPlatforms, getEnabledRegions } from '../registry.js';

beforeEach(() => {
  mockPlatformSettings = [
    { platform: 'craigslist', enabled: true },
    { platform: 'offerup', enabled: false },
  ];
  mockRegions = [
    { id: 1, name: 'seattle', latitude: 47.6, longitude: -122.3, radiusMiles: 30, clSubdomain: 'seattle', enabled: true },
    { id: 2, name: 'portland', latitude: 45.5, longitude: -122.7, radiusMiles: 25, clSubdomain: 'portland', enabled: false },
  ];
});

describe('Platform Registry', () => {
  it('returns CraigslistIntegration for "craigslist"', () => {
    const integration = getIntegration('craigslist');
    expect(integration).toBeDefined();
    expect(integration!.platform).toBe('craigslist');
  });

  it('returns OfferUpIntegration for "offerup"', () => {
    const integration = getIntegration('offerup');
    expect(integration).toBeDefined();
    expect(integration!.platform).toBe('offerup');
  });

  it('returns undefined for unknown platform', () => {
    const integration = getIntegration('facebook');
    expect(integration).toBeUndefined();
  });

  it('getEnabledPlatforms returns only enabled platforms with registered integrations', async () => {
    const platforms = await getEnabledPlatforms();
    expect(platforms).toHaveLength(1);
    expect(platforms[0].platform).toBe('craigslist');
  });

  it('getEnabledRegions returns only enabled regions', async () => {
    const regions = await getEnabledRegions();
    expect(regions).toHaveLength(1);
    expect(regions[0].name).toBe('seattle');
  });
});
