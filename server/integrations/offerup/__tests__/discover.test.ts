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

function mockOfferUpPage(listings: Array<{ id: string; title: string; price: number; city: string }>) {
  const tiles = listings.map((l) => ({
    __typename: 'ModularFeedTileListing',
    listing: {
      listingId: l.id,
      title: l.title,
      price: l.price,
      locationName: l.city,
      image: { url: `https://images.offerup.com/${l.id}.jpg` },
    },
  }));

  const nextData = {
    props: {
      pageProps: {
        searchFeedResponse: {
          looseTiles: [
            ...tiles,
            { __typename: 'ModularFeedTileGoogleDisplayAd' }, // noise tile
          ],
        },
      },
    },
  };

  return {
    ok: true,
    status: 200,
    headers: { getSetCookie: () => [] },
    text: () => Promise.resolve(
      `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></html>`
    ),
  };
}

const emptyPage = mockOfferUpPage([]);
const warmCookieResp = { ok: true, status: 200, headers: { getSetCookie: () => [] }, text: () => Promise.resolve('') };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OfferUp discover', () => {
  it('parses listings from __NEXT_DATA__', async () => {
    // warmCookies, then return listings on first query, empty for the rest
    mockFetch
      .mockResolvedValueOnce(warmCookieResp)
      .mockResolvedValueOnce(mockOfferUpPage([
        { id: 'abc-123', title: 'Oak Dresser', price: 150, city: 'Seattle, WA' },
        { id: 'def-456', title: 'Pine Table', price: 75, city: 'Bellevue, WA' },
      ]))
      .mockResolvedValue(emptyPage);

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

  it('filters out non-listing tiles', async () => {
    mockFetch
      .mockResolvedValueOnce(warmCookieResp)
      .mockResolvedValueOnce(mockOfferUpPage([
        { id: 'only-one', title: 'Chair', price: 50, city: 'Renton, WA' },
      ]))
      .mockResolvedValue(emptyPage);

    const results = await discover(testRegion, 0);
    expect(results).toHaveLength(1);
  });

  it('returns empty array when no __NEXT_DATA__ found', async () => {
    const noDataPage = {
      ok: true, status: 200, headers: { getSetCookie: () => [] },
      text: () => Promise.resolve('<html><body>No data</body></html>'),
    };
    mockFetch
      .mockResolvedValueOnce(warmCookieResp)
      .mockResolvedValue(noDataPage);

    const results = await discover(testRegion, 0);
    expect(results).toHaveLength(0);
  });

  it('continues on individual query failures', async () => {
    // warmCookies succeeds, first query fails, second has results, rest empty
    mockFetch
      .mockResolvedValueOnce(warmCookieResp)
      .mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden', headers: { getSetCookie: () => [] } })
      .mockResolvedValueOnce(mockOfferUpPage([
        { id: 'recovered', title: 'Table', price: 100, city: 'Seattle, WA' },
      ]))
      .mockResolvedValue(emptyPage);

    const results = await discover(testRegion, 0);
    expect(results).toHaveLength(1);
    expect(results[0].externalId).toBe('recovered');
  });

  it('deduplicates listings across search queries', async () => {
    // Same listing appears in two different query results
    mockFetch
      .mockResolvedValueOnce(warmCookieResp)
      .mockResolvedValueOnce(mockOfferUpPage([
        { id: 'abc-123', title: 'Oak Dresser', price: 150, city: 'Seattle, WA' },
      ]))
      .mockResolvedValueOnce(mockOfferUpPage([
        { id: 'abc-123', title: 'Oak Dresser', price: 150, city: 'Seattle, WA' },
        { id: 'def-456', title: 'Pine Table', price: 75, city: 'Bellevue, WA' },
      ]))
      .mockResolvedValue(emptyPage);

    const results = await discover(testRegion, 0);
    expect(results).toHaveLength(2); // abc-123 only counted once
  });

  it('fetches all search queries per call', async () => {
    mockFetch
      .mockResolvedValueOnce(warmCookieResp)
      .mockResolvedValue(emptyPage);

    await discover(testRegion, 0);

    // 1 warmCookies call + N search query calls
    const searchCalls = mockFetch.mock.calls.slice(1);
    expect(searchCalls.length).toBeGreaterThan(1);
    // All calls should be to offerup search
    for (const call of searchCalls) {
      expect(call[0]).toContain('offerup.com/search');
    }
    // Different queries should be used
    const queries = searchCalls.map((c: any) => new URL(c[0]).searchParams.get('q'));
    const uniqueQueries = new Set(queries);
    expect(uniqueQueries.size).toBeGreaterThan(1);
  });
});
