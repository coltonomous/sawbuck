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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OfferUp discover', () => {
  it('parses listings from __NEXT_DATA__', async () => {
    // First call: warmCookies homepage
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: { getSetCookie: () => [] }, text: () => Promise.resolve('') });
    // Second call: search page
    mockFetch.mockResolvedValueOnce(mockOfferUpPage([
      { id: 'abc-123', title: 'Oak Dresser', price: 150, city: 'Seattle, WA' },
      { id: 'def-456', title: 'Pine Table', price: 75, city: 'Bellevue, WA' },
    ]));

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
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: { getSetCookie: () => [] }, text: () => Promise.resolve('') });
    mockFetch.mockResolvedValueOnce(mockOfferUpPage([
      { id: 'only-one', title: 'Chair', price: 50, city: 'Renton, WA' },
    ]));

    const results = await discover(testRegion, 0);
    expect(results).toHaveLength(1); // ad tile was filtered out
  });

  it('returns empty array when no __NEXT_DATA__ found', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: { getSetCookie: () => [] }, text: () => Promise.resolve('') });
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, headers: { getSetCookie: () => [] },
      text: () => Promise.resolve('<html><body>No data</body></html>'),
    });

    const results = await discover(testRegion, 0);
    expect(results).toHaveLength(0);
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: { getSetCookie: () => [] }, text: () => Promise.resolve('') });
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 403, statusText: 'Forbidden',
      headers: { getSetCookie: () => [] },
    });

    await expect(discover(testRegion, 0)).rejects.toThrow('403');
  });

  it('uses rotated search queries based on page', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: { getSetCookie: () => [] }, text: () => Promise.resolve('') });
    mockFetch.mockResolvedValueOnce(mockOfferUpPage([]));

    await discover(testRegion, 0);

    // Check the URL used for the search (second fetch call)
    const searchUrl = mockFetch.mock.calls[1][0];
    expect(searchUrl).toContain('offerup.com/search');
    expect(searchUrl).toContain('LOCATION_LATITUDE=47.6');
    expect(searchUrl).toContain('SEARCH_RADIUS=30');
    // Should NOT just be "wood furniture" (rotated queries)
    expect(searchUrl).toMatch(/q=[^&]+/);
  });
});
