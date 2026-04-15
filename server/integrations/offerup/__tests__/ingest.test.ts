import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock anti-blocking
vi.mock('../../../agents/anti-blocking.js', () => ({
  AntiBlockingController: class {
    async beforeRequest() {}
    onSuccess() {}
    onError() {}
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { enrich } from '../ingest.js';
import type { ScrapedCandidate } from '../../common/types.js';

function mockResponse(opts: { ok: boolean; status: number; text?: () => Promise<string> }) {
  return {
    ...opts,
    headers: { getSetCookie: () => [] },
    text: opts.text ?? (() => Promise.resolve('')),
  };
}

function makeCandidate(overrides: Partial<ScrapedCandidate> = {}): ScrapedCandidate {
  return {
    externalId: `test-${Math.random().toString(36).slice(2)}`,
    platform: 'offerup',
    url: 'https://offerup.com/item/detail/12345',
    title: 'Test item',
    askingPrice: 50,
    location: 'Seattle',
    imageUrls: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OfferUp enrich', () => {
  it('marks 404 listings as removed', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 404 }));

    const { enriched, removedIds } = await enrich([makeCandidate({ externalId: 'gone-1' })]);

    expect(removedIds).toContain('gone-1');
    expect(enriched).toHaveLength(0);
  });

  it('marks 410 listings as removed', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 410 }));

    const { enriched, removedIds } = await enrich([makeCandidate({ externalId: 'sold-1' })]);

    expect(removedIds).toContain('sold-1');
    expect(enriched).toHaveLength(0);
  });

  it('detects "no longer available" pages as removed', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html><body>This item is no longer available</body></html>'),
    }));

    const { enriched, removedIds } = await enrich([makeCandidate({ externalId: 'unavail-1' })]);

    expect(removedIds).toContain('unavail-1');
    expect(enriched).toHaveLength(0);
  });

  it('extracts data from __NEXT_DATA__ JSON', async () => {
    const nextData = {
      props: {
        pageProps: {
          listing: {
            description: 'Beautiful solid wood dresser',
            photos: [
              { uuid: 'abc123' },
              { url: 'https://images.offerup.com/direct.jpg' },
            ],
          },
        },
      },
    };

    mockFetch.mockResolvedValueOnce(mockResponse({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></html>`),
    }));

    const { enriched } = await enrich([makeCandidate()]);

    expect(enriched).toHaveLength(1);
    expect(enriched[0].description).toBe('Beautiful solid wood dresser');
    expect(enriched[0].imageUrls).toHaveLength(2);
    expect(enriched[0].imageUrls[0]).toContain('abc123');
    expect(enriched[0].imageUrls[1]).toBe('https://images.offerup.com/direct.jpg');
  });

  it('falls back to meta tags when no __NEXT_DATA__', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`<html>
        <meta name="description" content="Nice table for sale">
        <meta property="og:image" content="https://images.offerup.com/og.jpg">
      </html>`),
    }));

    const { enriched } = await enrich([makeCandidate()]);

    expect(enriched).toHaveLength(1);
    expect(enriched[0].description).toBe('Nice table for sale');
    expect(enriched[0].imageUrls).toContain('https://images.offerup.com/og.jpg');
  });

  it('keeps original candidate data on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const original = makeCandidate({ description: 'original desc' });
    const { enriched, removedIds } = await enrich([original]);

    expect(enriched).toHaveLength(1);
    expect(enriched[0].description).toBe('original desc');
    expect(removedIds).toHaveLength(0);
  });

  it('handles empty candidate list', async () => {
    const { enriched, removedIds } = await enrich([]);
    expect(enriched).toHaveLength(0);
    expect(removedIds).toHaveLength(0);
  });

  it('extracts coordinates from listing.location nested object', async () => {
    const nextData = {
      props: {
        pageProps: {
          listing: {
            description: 'Dresser',
            photos: [],
            location: { latitude: 47.6062, longitude: -122.3321 },
          },
        },
      },
    };

    mockFetch.mockResolvedValueOnce(mockResponse({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></html>`),
    }));

    const { enriched } = await enrich([makeCandidate()]);

    expect(enriched[0].latitude).toBeCloseTo(47.6062);
    expect(enriched[0].longitude).toBeCloseTo(-122.3321);
  });

  it('extracts coordinates from top-level listing.lat/lng', async () => {
    const nextData = {
      props: {
        pageProps: {
          listing: {
            description: 'Table',
            photos: [],
            lat: 34.0522,
            lng: -118.2437,
          },
        },
      },
    };

    mockFetch.mockResolvedValueOnce(mockResponse({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></html>`),
    }));

    const { enriched } = await enrich([makeCandidate()]);

    expect(enriched[0].latitude).toBeCloseTo(34.0522);
    expect(enriched[0].longitude).toBeCloseTo(-118.2437);
  });

  it('rejects out-of-bounds coordinates', async () => {
    const nextData = {
      props: {
        pageProps: {
          listing: {
            description: 'Chair',
            photos: [],
            location: { latitude: 999, longitude: -122 },
          },
        },
      },
    };

    mockFetch.mockResolvedValueOnce(mockResponse({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></html>`),
    }));

    const { enriched } = await enrich([makeCandidate()]);

    expect(enriched[0].latitude).toBeUndefined();
    expect(enriched[0].longitude).toBeUndefined();
  });

  it('returns undefined coordinates when location data is missing', async () => {
    const nextData = {
      props: {
        pageProps: {
          listing: {
            description: 'No location info',
            photos: [],
          },
        },
      },
    };

    mockFetch.mockResolvedValueOnce(mockResponse({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></html>`),
    }));

    const { enriched } = await enrich([makeCandidate()]);

    expect(enriched[0].latitude).toBeUndefined();
    expect(enriched[0].longitude).toBeUndefined();
  });
});
