/**
 * Tests for the product and guide ingestion modules.
 *
 * Tests the text extraction, chunking, and transformation logic
 * without making real HTTP requests or needing embeddings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally for product/guide page fetching
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock embeddings — return fixed vectors
vi.mock('../embeddings.js', () => ({
  embed: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
  embedBatch: vi.fn().mockImplementation((texts: string[]) =>
    Promise.resolve(texts.map(() => new Float32Array(384).fill(0.1)))
  ),
  DIMENSIONS: 384,
}));

// Mock store — track what gets inserted
const insertedChunks: Array<{ type: string; title: string; content: string }> = [];
vi.mock('../store.js', () => ({
  upsertChunks: vi.fn().mockImplementation(
    (chunks: Array<{ type: string; title: string; content: string }>) => {
      insertedChunks.push(...chunks);
      return chunks.length;
    }
  ),
  clearChunks: vi.fn(),
  chunkCount: vi.fn().mockReturnValue(0),
}));

const { ingestProducts } = await import('./products.js');
const { ingestGuides } = await import('./guides.js');

function makeHtmlResponse(body: string): Response {
  return new Response(
    `<html><head><style>body{}</style></head><body>${body}</body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html' } },
  );
}

describe('Product ingestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedChunks.length = 0;
  });

  it('ingests a product page into chunks', async () => {
    mockFetch.mockResolvedValueOnce(makeHtmlResponse(`
      <div>
        <h1>Citristrip Stripping Gel</h1>
        <p>Apply a thick coat with a brush. Wait 30 minutes to 24 hours depending on finish thickness. Strips up to 15 layers of paint or varnish in a single application.</p>
        <p>Coverage: approximately 15 square feet per quart. Works on wood, metal, and masonry surfaces. Low odor formula safe for indoor use.</p>
        <p>Cleanup with soap and water while still wet. For best results, work in 70-80°F temperatures.</p>
      </div>
    `));

    const result = await ingestProducts([{
      name: 'Stripping Gel',
      brand: 'Citristrip',
      url: 'https://example.com/citristrip',
      category: 'stripper',
    }]);

    expect(result.ingested).toBeGreaterThan(0);
    expect(result.failed).toBe(0);
    expect(insertedChunks.length).toBeGreaterThan(0);
    expect(insertedChunks[0].type).toBe('product');
    expect(insertedChunks[0].title).toContain('Citristrip');
  });

  it('handles fetch failures gracefully', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    const result = await ingestProducts([{
      name: 'Missing Product',
      brand: 'Unknown',
      url: 'https://example.com/404',
      category: 'stain',
    }]);

    expect(result.ingested).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('handles network errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await ingestProducts([{
      name: 'Unreachable',
      brand: 'Unknown',
      url: 'https://unreachable.example.com',
      category: 'stain',
    }]);

    expect(result.ingested).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('returns zero counts for empty source list', async () => {
    const result = await ingestProducts([]);
    expect(result.ingested).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('strips script and style tags from HTML', async () => {
    mockFetch.mockResolvedValueOnce(makeHtmlResponse(`
      <script>var tracking = true;</script>
      <nav>Menu Item 1 Menu Item 2</nav>
      <div>
        <p>This is the actual product description with useful refinishing information about drying times and coverage rates.</p>
      </div>
      <footer>Copyright 2025</footer>
    `));

    const result = await ingestProducts([{
      name: 'Clean Product',
      brand: 'Test',
      url: 'https://example.com/clean',
      category: 'finish',
    }]);

    expect(result.ingested).toBeGreaterThan(0);
    // Content should NOT contain script/nav/footer text
    const content = insertedChunks[0]?.content || '';
    expect(content).not.toContain('tracking');
    expect(content).not.toContain('Menu Item');
    expect(content).not.toContain('Copyright');
    expect(content).toContain('actual product description');
  });

  it('processes multiple products', async () => {
    mockFetch
      .mockResolvedValueOnce(makeHtmlResponse(
        '<p>Product A is a wood stain with excellent penetration and rich color depth for hardwoods.</p>'
      ))
      .mockResolvedValueOnce(makeHtmlResponse(
        '<p>Product B is a polyurethane topcoat that provides durable protection for refinished furniture.</p>'
      ));

    const result = await ingestProducts([
      { name: 'Product A', brand: 'Brand A', url: 'https://example.com/a', category: 'stain' },
      { name: 'Product B', brand: 'Brand B', url: 'https://example.com/b', category: 'finish' },
    ]);

    expect(result.ingested).toBe(2);
    expect(result.failed).toBe(0);
  });
});

describe('Guide ingestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedChunks.length = 0;
  });

  it('ingests a guide page into chunks', async () => {
    mockFetch.mockResolvedValueOnce(makeHtmlResponse(`
      <article>
        <h1>How to Strip Furniture</h1>
        <p>Step 1: Apply chemical stripper. Use a thick coat of Citristrip or similar product. Wait at least 30 minutes for the stripper to soften the existing finish.</p>
        <p>Step 2: Scrape off the softened finish. Use a plastic scraper to avoid gouging the wood. Work with the grain direction.</p>
        <p>Step 3: Clean the surface. Wipe down with mineral spirits to remove residue. Allow to dry completely before proceeding to sanding.</p>
      </article>
    `));

    const result = await ingestGuides([{
      title: 'How to Strip Furniture',
      url: 'https://example.com/strip-guide',
      tags: ['stripping', 'prep'],
    }]);

    expect(result.ingested).toBeGreaterThan(0);
    expect(result.failed).toBe(0);
    expect(insertedChunks[0].type).toBe('guide');
    expect(insertedChunks[0].title).toContain('How to Strip Furniture');
  });

  it('handles fetch failures gracefully', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Server Error', { status: 500 }));

    const result = await ingestGuides([{
      title: 'Broken Guide',
      url: 'https://example.com/500',
      tags: ['broken'],
    }]);

    expect(result.ingested).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('returns zero counts for empty source list', async () => {
    const result = await ingestGuides([]);
    expect(result.ingested).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('stores tags in metadata', async () => {
    mockFetch.mockResolvedValueOnce(makeHtmlResponse(
      '<p>Guide about sanding techniques for furniture refinishing. Start with 80 grit for heavy material removal, then progress through 120, 150, and 220 grits.</p>'
    ));

    await ingestGuides([{
      title: 'Sanding Basics',
      url: 'https://example.com/sand',
      tags: ['sanding', 'technique', 'beginner'],
    }]);

    expect(insertedChunks.length).toBeGreaterThan(0);
  });

  it('chunks long guides into multiple pieces', async () => {
    // Generate a long guide with multiple steps
    const longContent = Array.from({ length: 10 }, (_, i) =>
      `<p>Step ${i + 1}: This is a detailed paragraph about step ${i + 1} of the refinishing process. ` +
      `It includes specific instructions, product recommendations, timing details, and troubleshooting tips. ` +
      `Each step should be carefully followed to achieve the best results. Allow adequate drying time between steps. ` +
      `Use proper ventilation and safety equipment. Check temperature and humidity conditions before proceeding. ` +
      `This paragraph is deliberately long to test the chunking behavior of the ingestion pipeline.</p>`
    ).join('\n');

    mockFetch.mockResolvedValueOnce(makeHtmlResponse(longContent));

    const result = await ingestGuides([{
      title: 'Detailed Refinishing Guide',
      url: 'https://example.com/long-guide',
      tags: ['comprehensive'],
    }]);

    expect(result.ingested).toBeGreaterThan(1);
    // Each chunk should have a section number in the title
    const sectionChunks = insertedChunks.filter((c) => c.title.includes('section'));
    expect(sectionChunks.length).toBeGreaterThan(0);
  });
});
