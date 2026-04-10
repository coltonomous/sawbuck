import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScrapedCandidate } from '../../common/types.js';

// Mock anti-blocking to skip delays
vi.mock('../../../agents/anti-blocking.js', () => ({
  AntiBlockingController: class {
    async beforeRequest() {}
    onSuccess() {}
    onError() {}
  },
}));

// We test enrich() which doesn't touch the DB, and test
// discover()'s parsing logic via exported helpers.
// Full discover() integration is tested via the pipeline test.

// Import the module internals for unit testing
// We need to test: RSS parsing, title parsing, detail page parsing
// These are private functions, so we test them through enrich() and via
// a separate test of the parsing logic by importing the module.

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// We can't easily test discover() without a real DB mock, so test enrich() directly
import { enrich } from '../ingest.js';

const SAMPLE_DETAIL = `<html><body>
<section id="postingbody">Beautiful solid oak dresser, 6 drawers.
QR Code Link to This Post</section>
<div id="map" data-latitude="47.6145" data-longitude="-122.3210"></div>
<img src="https://images.craigslist.org/oak1_600x450.jpg">
<img src="https://images.craigslist.org/oak2_300x300.jpg">
</body></html>`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enrich', () => {
  it('extracts description, images, and coordinates from detail page', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(SAMPLE_DETAIL) });

    const results = await enrich([{
      externalId: '7777777', url: 'https://seattle.craigslist.org/d/test/7777777.html',
      title: 'Dresser', askingPrice: 150, location: 'Seattle', imageUrls: [],
    }]);

    expect(results).toHaveLength(1);
    expect(results[0].description).toContain('Beautiful solid oak');
    expect(results[0].description).not.toContain('QR Code');
    expect(results[0].latitude).toBeCloseTo(47.6145);
    expect(results[0].longitude).toBeCloseTo(-122.321);
    expect(results[0].imageUrls).toHaveLength(2);
  });

  it('normalizes image URLs to 600x450', async () => {
    const html = `<html><body>
      <section id="postingbody">test</section>
      <img src="https://images.craigslist.org/img1_300x300.jpg">
      <img src="https://images.craigslist.org/img2_1200x900.png">
    </body></html>`;
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(html) });

    const results = await enrich([{
      externalId: '1', url: 'https://example.com/1.html',
      title: 'Test', askingPrice: null, location: '', imageUrls: [],
    }]);

    for (const url of results[0].imageUrls) {
      expect(url).toContain('_600x450.');
    }
  });

  it('keeps RSS data when detail page fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const results = await enrich([{
      externalId: '1', url: 'https://example.com/fail.html',
      title: 'Original', askingPrice: 50, location: 'Seattle',
      imageUrls: ['https://example.com/thumb.jpg'], description: 'RSS desc',
    }]);

    expect(results[0].title).toBe('Original');
    expect(results[0].description).toBe('RSS desc');
    expect(results[0].imageUrls).toEqual(['https://example.com/thumb.jpg']);
  });

  it('keeps RSS data when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const results = await enrich([{
      externalId: '1', url: 'https://example.com/error.html',
      title: 'Original', askingPrice: 50, location: 'Seattle', imageUrls: [],
    }]);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Original');
  });

  it('rejects out-of-range coordinates', async () => {
    const html = `<html><body>
      <section id="postingbody">Test</section>
      <div id="map" data-latitude="999" data-longitude="-999"></div>
    </body></html>`;
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(html) });

    const results = await enrich([{
      externalId: '1', url: 'https://example.com/bad.html',
      title: 'Bad', askingPrice: null, location: '', imageUrls: [],
    }]);

    expect(results[0].latitude).toBeUndefined();
    expect(results[0].longitude).toBeUndefined();
  });

  it('accepts valid coordinates', async () => {
    const html = `<html><body>
      <section id="postingbody">Test</section>
      <div id="map" data-latitude="47.6062" data-longitude="-122.3321"></div>
    </body></html>`;
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(html) });

    const results = await enrich([{
      externalId: '1', url: 'https://example.com/good.html',
      title: 'Good', askingPrice: null, location: '', imageUrls: [],
    }]);

    expect(results[0].latitude).toBeCloseTo(47.6062);
    expect(results[0].longitude).toBeCloseTo(-122.3321);
  });

  it('handles multiple candidates', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(SAMPLE_DETAIL) })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    const results = await enrich([
      { externalId: '1', url: 'https://example.com/1.html', title: 'A', askingPrice: 50, location: '', imageUrls: [] },
      { externalId: '2', url: 'https://example.com/2.html', title: 'B', askingPrice: 75, location: '', imageUrls: ['thumb.jpg'] },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].description).toContain('Beautiful'); // enriched
    expect(results[1].imageUrls).toEqual(['thumb.jpg']); // fell back to RSS
  });

  it('strips HTML tags from description', async () => {
    const html = `<html><body>
      <section id="postingbody"><b>Bold text</b> and <a href="x">link</a> content</section>
    </body></html>`;
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(html) });

    const results = await enrich([{
      externalId: '1', url: 'https://example.com/1.html',
      title: 'Test', askingPrice: null, location: '', imageUrls: [],
    }]);

    expect(results[0].description).toBe('Bold text and link content');
  });
});
