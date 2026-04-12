import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock anti-blocking to skip delays
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

// Helper: wrap a mock response with the headers.getSetCookie() that clFetch expects
function mockResponse(opts: { ok: boolean; status: number; text?: () => Promise<string> }) {
  return {
    ...opts,
    headers: { getSetCookie: () => [] },
    text: opts.text ?? (() => Promise.resolve('')),
  };
}

const SAMPLE_DETAIL = `<html><body>
<section id="postingbody">Beautiful solid oak dresser, 6 drawers.
QR Code Link to This Post</section>
<div id="map" data-latitude="47.6145" data-longitude="-122.3210"></div>
<img src="https://images.craigslist.org/oak1_600x450.jpg">
<img src="https://images.craigslist.org/oak2_300x300.jpg">
</body></html>`;

function makeCandidate(overrides: Partial<Parameters<typeof enrich>[0][0]> = {}) {
  return {
    externalId: `test-${Math.random().toString(36).slice(2)}`,
    url: 'https://seattle.craigslist.org/d/test/1234567.html',
    title: 'Test item',
    askingPrice: 50 as number | null,
    location: 'Seattle',
    imageUrls: [] as string[],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enrich', () => {
  it('extracts description, images, and coordinates from detail page', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 200, text: () => Promise.resolve(SAMPLE_DETAIL) }));

    const { enriched, removedIds } = await enrich([makeCandidate({
      externalId: '7777777', url: 'https://seattle.craigslist.org/d/test/7777777.html',
      title: 'Dresser', askingPrice: 150,
    })]);

    expect(enriched).toHaveLength(1);
    expect(removedIds).toHaveLength(0);
    expect(enriched[0].description).toContain('Beautiful solid oak');
    expect(enriched[0].description).not.toContain('QR Code');
    expect(enriched[0].latitude).toBeCloseTo(47.6145);
    expect(enriched[0].longitude).toBeCloseTo(-122.321);
    expect(enriched[0].imageUrls).toHaveLength(2);
  });

  it('normalizes image URLs to 600x450', async () => {
    const html = `<html><body>
      <section id="postingbody">test</section>
      <img src="https://images.craigslist.org/img1_300x300.jpg">
      <img src="https://images.craigslist.org/img2_1200x900.png">
    </body></html>`;
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 200, text: () => Promise.resolve(html) }));

    const { enriched } = await enrich([makeCandidate()]);

    for (const url of enriched[0].imageUrls) {
      expect(url).toContain('_600x450.');
    }
  });

  it('strips HTML tags from description', async () => {
    const html = `<html><body>
      <section id="postingbody"><b>Bold text</b> and <a href="x">link</a> content</section>
    </body></html>`;
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 200, text: () => Promise.resolve(html) }));

    const { enriched } = await enrich([makeCandidate()]);

    expect(enriched[0].description).toBe('Bold text and link content');
  });

  it('rejects out-of-range coordinates', async () => {
    const html = `<html><body>
      <section id="postingbody">Test</section>
      <div id="map" data-latitude="999" data-longitude="-999"></div>
    </body></html>`;
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 200, text: () => Promise.resolve(html) }));

    const { enriched } = await enrich([makeCandidate()]);

    expect(enriched[0].latitude).toBeUndefined();
    expect(enriched[0].longitude).toBeUndefined();
  });

  it('accepts valid coordinates', async () => {
    const html = `<html><body>
      <section id="postingbody">Test</section>
      <div id="map" data-latitude="47.6062" data-longitude="-122.3321"></div>
    </body></html>`;
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 200, text: () => Promise.resolve(html) }));

    const { enriched } = await enrich([makeCandidate()]);

    expect(enriched[0].latitude).toBeCloseTo(47.6062);
    expect(enriched[0].longitude).toBeCloseTo(-122.3321);
  });

  it('handles multiple candidates with mixed results', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, text: () => Promise.resolve(SAMPLE_DETAIL) }))
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 500 }));

    const { enriched } = await enrich([
      makeCandidate({ externalId: '1', url: 'https://example.com/1.html', title: 'A' }),
      makeCandidate({ externalId: '2', url: 'https://example.com/2.html', title: 'B', imageUrls: ['thumb.jpg'] }),
    ]);

    expect(enriched).toHaveLength(2);
    expect(enriched[0].description).toContain('Beautiful'); // enriched
    expect(enriched[1].imageUrls).toEqual(['thumb.jpg']); // fell back to RSS
  });

  it('keeps RSS data when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { enriched, removedIds } = await enrich([
      makeCandidate({ title: 'Original', description: 'RSS desc' }),
    ]);

    expect(enriched).toHaveLength(1);
    expect(removedIds).toHaveLength(0);
    expect(enriched[0].title).toBe('Original');
    expect(enriched[0].description).toBe('RSS desc');
  });

  it('returns empty results for empty input', async () => {
    const { enriched, removedIds } = await enrich([]);
    expect(enriched).toHaveLength(0);
    expect(removedIds).toHaveLength(0);
  });
});

describe('removal detection', () => {
  it('flags 404 responses as removed', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 404 }));

    const candidate = makeCandidate({ externalId: 'gone-404' });
    const { enriched, removedIds } = await enrich([candidate]);

    expect(enriched).toHaveLength(0);
    expect(removedIds).toEqual(['gone-404']);
  });

  it('flags "This posting has been deleted" pages as removed', async () => {
    const html = `<html><body><h2>This posting has been deleted by its author.</h2></body></html>`;
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 200, text: () => Promise.resolve(html) }));

    const candidate = makeCandidate({ externalId: 'gone-deleted' });
    const { enriched, removedIds } = await enrich([candidate]);

    expect(enriched).toHaveLength(0);
    expect(removedIds).toEqual(['gone-deleted']);
  });

  it('flags "This posting has expired" pages as removed', async () => {
    const html = `<html><body><h2>This posting has expired.</h2></body></html>`;
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: 200, text: () => Promise.resolve(html) }));

    const candidate = makeCandidate({ externalId: 'gone-expired' });
    const { enriched, removedIds } = await enrich([candidate]);

    expect(enriched).toHaveLength(0);
    expect(removedIds).toEqual(['gone-expired']);
  });

  it('does not flag non-404 errors as removed', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 503 }));

    const candidate = makeCandidate({ externalId: 'server-error', description: 'RSS data' });
    const { enriched, removedIds } = await enrich([candidate]);

    expect(removedIds).toHaveLength(0);
    expect(enriched).toHaveLength(1);
    expect(enriched[0].description).toBe('RSS data');
  });

  it('separates removed and enriched in mixed batch', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, text: () => Promise.resolve(SAMPLE_DETAIL) }))
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 404 }))
      .mockResolvedValueOnce(mockResponse({ ok: true, status: 200, text: () => Promise.resolve(SAMPLE_DETAIL) }));

    const { enriched, removedIds } = await enrich([
      makeCandidate({ externalId: 'keep-1' }),
      makeCandidate({ externalId: 'gone-1' }),
      makeCandidate({ externalId: 'keep-2' }),
    ]);

    expect(enriched).toHaveLength(2);
    expect(enriched.map(c => c.externalId)).toEqual(['keep-1', 'keep-2']);
    expect(removedIds).toEqual(['gone-1']);
  });
});
