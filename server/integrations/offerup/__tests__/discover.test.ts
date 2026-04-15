import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../agents/anti-blocking.js', () => ({
  AntiBlockingController: class {
    async beforeRequest() {}
    onSuccess() {}
    onError() {}
  },
}));

vi.mock('../../../db/index.js', () => {
  const makeChain = () => {
    const chain: any = {};
    for (const m of ['select', 'from', 'where', 'limit']) {
      chain[m] = () => chain;
    }
    chain.then = (resolve: any) => resolve([]);
    chain.catch = () => chain;
    return chain;
  };
  return { db: { select: () => makeChain() } };
});

vi.mock('../../../db/schema.js', () => ({
  listings: { externalId: 'external_id', platform: 'platform' },
}));

vi.mock('../../../lib/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../agents/config.js', () => ({
  agentConfig: {
    minDelayBetweenRequestsMs: 0,
    maxDelayBetweenRequestsMs: 0,
    dailyRequestCap: 1000,
  },
}));

// Eliminate inter-query delays in tests
vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any) => { fn(); return 0 as any; });

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Must import after mocks
const { discover } = await import('../ingest.js');

const testRegion = { id: 1, name: 'seattle', latitude: 47.6, longitude: -122.3, radiusMiles: 30, clSubdomain: 'seattle' };

function mockGraphQLResponse(listings: Array<{ id: string; title: string; price: number; city: string }>) {
  const tiles = listings.map((l) => ({
    tileId: l.id,
    tileType: 'LISTING',
    listing: {
      listingId: l.id,
      title: l.title,
      price: l.price,
      locationName: l.city,
      image: { url: `https://images.offerup.com/${l.id}.jpg`, width: 600, height: 600 },
    },
  }));

  return {
    ok: true,
    status: 200,
    headers: { getSetCookie: () => [] },
    json: () => Promise.resolve({
      data: {
        modularFeed: {
          looseTiles: tiles,
        },
      },
    }),
    text: () => Promise.resolve(JSON.stringify({ data: { modularFeed: { looseTiles: tiles } } })),
  };
}

const emptyResponse = mockGraphQLResponse([]);
const warmCookieResp = { ok: true, status: 200, headers: { getSetCookie: () => [] }, text: () => Promise.resolve('') };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OfferUp discover', () => {
  it('parses listings from GraphQL response', async () => {
    // warmCookies, then return listings on first query, empty for the rest
    mockFetch
      .mockResolvedValueOnce(warmCookieResp)
      .mockResolvedValueOnce(mockGraphQLResponse([
        { id: 'abc-123', title: 'Oak Dresser', price: 150, city: 'Seattle, WA' },
        { id: 'def-456', title: 'Pine Table', price: 75, city: 'Bellevue, WA' },
      ]))
      .mockResolvedValue(emptyResponse);

    const results = await discover(testRegion, 0);

    expect(results).toHaveLength(2);
    expect(results[0].platform).toBe('offerup');
    expect(results[0].externalId).toBe('abc-123');
    expect(results[0].title).toBe('Oak Dresser');
    expect(results[0].askingPrice).toBe(150);
    expect(results[0].location).toBe('Seattle, WA');
    expect(results[0].imageUrls).toHaveLength(1);
    expect(results[1].externalId).toBe('def-456');
  });

  it('returns empty array when API returns no tiles', async () => {
    mockFetch
      .mockResolvedValueOnce(warmCookieResp)
      .mockResolvedValue(emptyResponse);

    const results = await discover(testRegion, 0);
    expect(results).toHaveLength(0);
  });

  it('continues on individual query failures', async () => {
    // warmCookies succeeds, first query fails, second has results, rest empty
    mockFetch
      .mockResolvedValueOnce(warmCookieResp)
      .mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden', headers: { getSetCookie: () => [] } })
      .mockResolvedValueOnce(mockGraphQLResponse([
        { id: 'recovered', title: 'Table', price: 100, city: 'Seattle, WA' },
      ]))
      .mockResolvedValue(emptyResponse);

    const results = await discover(testRegion, 0);
    expect(results).toHaveLength(1);
    expect(results[0].externalId).toBe('recovered');
  });

  it('deduplicates listings across search queries', async () => {
    // Same listing appears in two different query results
    mockFetch
      .mockResolvedValueOnce(warmCookieResp)
      .mockResolvedValueOnce(mockGraphQLResponse([
        { id: 'abc-123', title: 'Oak Dresser', price: 150, city: 'Seattle, WA' },
      ]))
      .mockResolvedValueOnce(mockGraphQLResponse([
        { id: 'abc-123', title: 'Oak Dresser', price: 150, city: 'Seattle, WA' },
        { id: 'def-456', title: 'Pine Table', price: 75, city: 'Bellevue, WA' },
      ]))
      .mockResolvedValue(emptyResponse);

    const results = await discover(testRegion, 0);
    expect(results).toHaveLength(2); // abc-123 only counted once
  });

  it('fetches all search queries per call', async () => {
    mockFetch
      .mockResolvedValueOnce(warmCookieResp)
      .mockResolvedValue(emptyResponse);

    await discover(testRegion, 0);

    // 1 warmCookies call + N search query calls
    const searchCalls = mockFetch.mock.calls.slice(1);
    expect(searchCalls.length).toBeGreaterThan(1);
    // All calls should be POST to the GraphQL API
    for (const call of searchCalls) {
      expect(call[0]).toBe('https://offerup.com/api/graphql');
      expect(call[1]?.method).toBe('POST');
    }
  });

  it('passes region coordinates as lat/lon in GraphQL variables', async () => {
    mockFetch
      .mockResolvedValueOnce(warmCookieResp)
      .mockResolvedValue(emptyResponse);

    await discover(testRegion, 0);

    const searchCalls = mockFetch.mock.calls.slice(1);
    for (const call of searchCalls) {
      const body = JSON.parse(call[1]?.body);
      const params = body.variables.searchParams;
      const lat = params.find((p: any) => p.key === 'lat');
      const lon = params.find((p: any) => p.key === 'lon');
      const distance = params.find((p: any) => p.key === 'distance');
      expect(lat.value).toBe(String(testRegion.latitude));
      expect(lon.value).toBe(String(testRegion.longitude));
      expect(distance.value).toBe(String(testRegion.radiusMiles));
    }
  });

  it('uses different search queries for each call', async () => {
    mockFetch
      .mockResolvedValueOnce(warmCookieResp)
      .mockResolvedValue(emptyResponse);

    await discover(testRegion, 0);

    const searchCalls = mockFetch.mock.calls.slice(1);
    const queries = searchCalls.map((c: any) => {
      const body = JSON.parse(c[1]?.body);
      return body.variables.searchParams.find((p: any) => p.key === 'q')?.value;
    });
    const uniqueQueries = new Set(queries);
    expect(uniqueQueries.size).toBeGreaterThan(1);
  });
});
