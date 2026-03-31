import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanupOrphanedImages } from './cleanup.js';

// Mock fs
vi.mock('fs', () => ({
  default: {
    statSync: vi.fn(() => ({ size: 50000 })),
    unlinkSync: vi.fn(),
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
    rmdirSync: vi.fn(),
  },
}));

// Mock logger
vi.mock('../lib/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Track DB operations
const mockDbState = {
  staleImages: [] as any[],
  updatedIds: [] as number[],
};

vi.mock('../db/index.js', () => {
  const handler = {
    get(_target: any, prop: string) {
      if (prop === 'all') return () => mockDbState.staleImages;
      if (prop === 'run') return () => {
        // Track which image IDs got updated
      };
      // Return the proxy for all chained methods
      return () => new Proxy({}, handler);
    },
  };
  return {
    db: new Proxy({}, {
      get(_target, prop) {
        if (prop === 'select') return () => new Proxy({}, handler);
        if (prop === 'update') return () => new Proxy({}, handler);
        return () => new Proxy({}, handler);
      },
    }),
  };
});

vi.mock('../db/schema.js', () => ({
  listings: { id: 'id', scrapedAt: 'scraped_at' },
  listingImages: { id: 'id', listingId: 'listing_id', localPathOriginal: 'local_path_original', localPathResized: 'local_path_resized', fileSizeBytes: 'file_size_bytes' },
  projects: { listingId: 'listing_id' },
}));

vi.mock('../lib/paths.js', () => ({
  IMAGES_DIR: '/app/data/images',
}));

vi.mock('../lib/config.js', () => ({
  config: {
    images: { retentionDays: 30 },
  },
}));

beforeEach(async () => {
  vi.restoreAllMocks();
  mockDbState.staleImages = [];

  // Re-apply default fs mocks (restoreAllMocks clears implementations)
  const fs = await import('fs');
  vi.spyOn(fs.default, 'statSync').mockReturnValue({ size: 50000 } as any);
  vi.spyOn(fs.default, 'unlinkSync').mockImplementation(() => {});
  vi.spyOn(fs.default, 'existsSync').mockReturnValue(false);
  vi.spyOn(fs.default, 'readdirSync').mockReturnValue([]);
  vi.spyOn(fs.default, 'rmdirSync').mockImplementation(() => {});
});

describe('cleanupOrphanedImages', () => {
  it('returns zero counts when no stale images exist', async () => {
    mockDbState.staleImages = [];
    const result = await cleanupOrphanedImages();
    expect(result.filesDeleted).toBe(0);
    expect(result.bytesFreed).toBe(0);
    expect(result.listingsCleaned).toBe(0);
  });

  it('deletes original and resized files for stale images', async () => {
    const fs = await import('fs');
    mockDbState.staleImages = [
      {
        imageId: 1,
        listingId: 100,
        localPathOriginal: 'originals/craigslist/100/0.jpg',
        localPathResized: 'resized/craigslist/100/0.webp',
        fileSizeBytes: 50000,
      },
    ];

    const result = await cleanupOrphanedImages();
    expect(result.filesDeleted).toBe(2);
    expect(result.bytesFreed).toBe(100000); // 50000 * 2
    expect(result.listingsCleaned).toBe(1);
    expect(fs.default.unlinkSync).toHaveBeenCalledTimes(2);
  });

  it('handles already-deleted files gracefully (ENOENT)', async () => {
    const fs = await import('fs');
    (fs.default.statSync as any).mockImplementation(() => {
      const err: any = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    mockDbState.staleImages = [
      {
        imageId: 2,
        listingId: 200,
        localPathOriginal: 'originals/offerup/200/0.jpg',
        localPathResized: null,
        fileSizeBytes: null,
      },
    ];

    const result = await cleanupOrphanedImages();
    // File didn't exist, so no bytes freed, but listing still cleaned
    expect(result.filesDeleted).toBe(0);
    expect(result.listingsCleaned).toBe(1);
  });

  it('skips null paths', async () => {
    const fs = await import('fs');
    mockDbState.staleImages = [
      {
        imageId: 3,
        listingId: 300,
        localPathOriginal: null,
        localPathResized: 'resized/mercari/300/0.webp',
        fileSizeBytes: 30000,
      },
    ];

    const result = await cleanupOrphanedImages();
    // Only the resized file should be deleted
    expect(result.filesDeleted).toBe(1);
    expect(fs.default.unlinkSync).toHaveBeenCalledTimes(1);
  });

  it('counts multiple images across multiple listings', async () => {
    mockDbState.staleImages = [
      { imageId: 10, listingId: 1000, localPathOriginal: 'originals/craigslist/1000/0.jpg', localPathResized: 'resized/craigslist/1000/0.webp', fileSizeBytes: 50000 },
      { imageId: 11, listingId: 1000, localPathOriginal: 'originals/craigslist/1000/1.jpg', localPathResized: 'resized/craigslist/1000/1.webp', fileSizeBytes: 60000 },
      { imageId: 12, listingId: 2000, localPathOriginal: 'originals/offerup/2000/0.jpg', localPathResized: null, fileSizeBytes: 40000 },
    ];

    const result = await cleanupOrphanedImages();
    expect(result.filesDeleted).toBe(5); // 2+2+1
    expect(result.listingsCleaned).toBe(2); // listing 1000 and 2000
  });
});
