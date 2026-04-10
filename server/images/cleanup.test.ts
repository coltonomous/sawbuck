import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanupOrphanedImages } from './cleanup.js';

// Track all fs operations with arguments
const fsOps = {
  unlinked: [] as string[],
  statted: [] as string[],
};

// Mock fs
vi.mock('fs', () => ({
  default: {
    statSync: vi.fn((path: string) => {
      fsOps.statted.push(path);
      return { size: 50000 };
    }),
    unlinkSync: vi.fn((path: string) => {
      fsOps.unlinked.push(path);
    }),
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
    rmdirSync: vi.fn(),
  },
}));

// Mock logger — track what gets logged
const loggedMessages = { info: [] as any[], warn: [] as any[] };
vi.mock('../lib/logger.js', () => ({
  default: {
    info: vi.fn((...args: any[]) => loggedMessages.info.push(args)),
    warn: vi.fn((...args: any[]) => loggedMessages.warn.push(args)),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Track DB update operations
const dbUpdates: { imageId: number; set: any }[] = [];

const mockDbState = {
  staleImages: [] as any[],
  selectCallCount: 0,
};

vi.mock('../db/index.js', () => {
  // Chainable mock that resolves to data when awaited
  // Each chain method returns the builder; awaiting it resolves the Promise
  const makeSelectChain = () => {
    const chain: any = {};
    const methods = ['select', 'from', 'innerJoin', 'where', 'orderBy'];
    for (const m of methods) {
      chain[m] = (..._args: any[]) => chain;
    }
    // Track by await (then), not by select: first await = stale images, rest = []
    chain.then = (resolve: any) => {
      const idx = mockDbState.selectCallCount++;
      resolve(idx === 0 ? mockDbState.staleImages : []);
    };
    chain.catch = () => chain;
    return chain;
  };

  const makeUpdateChain = () => {
    let setPayload: any = null;
    const chain: any = {};
    chain.update = () => chain;
    chain.set = (payload: any) => { setPayload = { ...payload }; return chain; };
    chain.where = () => chain;
    chain.then = (resolve: any) => {
      if (setPayload) dbUpdates.push({ imageId: -1, set: setPayload });
      resolve(undefined);
    };
    chain.catch = () => chain;
    return chain;
  };

  return {
    db: new Proxy({}, {
      get(_t, prop) {
        if (prop === 'select') return () => makeSelectChain();
        if (prop === 'update') return () => makeUpdateChain();
        return () => new Proxy({}, {
          get() { return () => new Proxy({}, { get() { return () => ({}); } }); },
        });
      },
    }),
  };
});

vi.mock('../db/schema.js', () => ({
  listings: { id: 'id', scrapedAt: 'scraped_at', userId: 'user_id', status: 'status' },
  listingImages: {
    id: 'id', listingId: 'listing_id',
    localPathOriginal: 'local_path_original',
    localPathResized: 'local_path_resized',
    fileSizeBytes: 'file_size_bytes',
  },
  projects: { listingId: 'listing_id' },
  conceptRenders: { listingId: 'listing_id', localPath: 'local_path' },
}));

vi.mock('../lib/paths.js', () => ({
  IMAGES_DIR: '/app/data/images',
}));

vi.mock('../lib/config.js', () => ({
  config: {
    images: { retentionDays: 30 },
  },
}));

vi.mock('../agents/config.js', () => ({
  agentConfig: {
    agentImageRetentionDays: 14,
  },
}));

beforeEach(async () => {
  vi.restoreAllMocks();
  mockDbState.staleImages = [];
  mockDbState.selectCallCount = 0;
  fsOps.unlinked = [];
  fsOps.statted = [];
  dbUpdates.length = 0;
  loggedMessages.info = [];
  loggedMessages.warn = [];

  // Re-apply fs mocks after restoreAllMocks
  const fs = await import('fs');
  vi.spyOn(fs.default, 'statSync').mockImplementation((path: any) => {
    fsOps.statted.push(path);
    return { size: 50000 } as any;
  });
  vi.spyOn(fs.default, 'unlinkSync').mockImplementation((path: any) => {
    fsOps.unlinked.push(path);
  });
  vi.spyOn(fs.default, 'existsSync').mockReturnValue(false);
  vi.spyOn(fs.default, 'readdirSync').mockReturnValue([]);
  vi.spyOn(fs.default, 'rmdirSync').mockImplementation(() => {});
});

describe('cleanupOrphanedImages', () => {
  it('returns zero counts and does not touch filesystem when no stale images', async () => {
    mockDbState.staleImages = [];
    const result = await cleanupOrphanedImages();
    expect(result.filesDeleted).toBe(0);
    expect(result.bytesFreed).toBe(0);
    expect(result.listingsCleaned).toBe(0);
    expect(fsOps.unlinked).toEqual([]);
    expect(fsOps.statted).toEqual([]);
  });

  it('deletes both original and resized files at correct paths', async () => {
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
    expect(result.bytesFreed).toBe(100000);
    expect(result.listingsCleaned).toBe(1);

    // Verify the exact file paths that were deleted
    expect(fsOps.unlinked).toEqual([
      '/app/data/images/originals/craigslist/100/0.jpg',
      '/app/data/images/resized/craigslist/100/0.webp',
    ]);
  });

  it('does NOT call unlinkSync when statSync throws ENOENT', async () => {
    const fs = await import('fs');
    (fs.default.statSync as any).mockImplementation((path: string) => {
      fsOps.statted.push(path);
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
    expect(result.filesDeleted).toBe(0);
    expect(result.listingsCleaned).toBe(1);
    // statSync was attempted but unlinkSync was never called
    expect(fsOps.statted).toEqual(['/app/data/images/originals/offerup/200/0.jpg']);
    expect(fsOps.unlinked).toEqual([]);
  });

  it('logs warning for non-ENOENT fs errors', async () => {
    const fs = await import('fs');
    (fs.default.statSync as any).mockImplementation((path: string) => {
      fsOps.statted.push(path);
      const err: any = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      throw err;
    });

    mockDbState.staleImages = [
      {
        imageId: 3,
        listingId: 300,
        localPathOriginal: 'originals/mercari/300/0.jpg',
        localPathResized: null,
        fileSizeBytes: null,
      },
    ];

    await cleanupOrphanedImages();
    // EACCES should trigger a warning (unlike ENOENT which is silent)
    expect(loggedMessages.warn.length).toBeGreaterThan(0);
  });

  it('only deletes resized file when original path is null', async () => {
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
    expect(result.filesDeleted).toBe(1);
    expect(fsOps.unlinked).toEqual(['/app/data/images/resized/mercari/300/0.webp']);
    // Original path was null — statSync should only be called for the resized file
    expect(fsOps.statted).toEqual(['/app/data/images/resized/mercari/300/0.webp']);
  });

  it('only deletes original file when resized path is null', async () => {
    mockDbState.staleImages = [
      {
        imageId: 4,
        listingId: 400,
        localPathOriginal: 'originals/facebook/400/0.jpg',
        localPathResized: null,
        fileSizeBytes: 40000,
      },
    ];

    const result = await cleanupOrphanedImages();
    expect(result.filesDeleted).toBe(1);
    expect(fsOps.unlinked).toEqual(['/app/data/images/originals/facebook/400/0.jpg']);
  });

  it('counts distinct listings across multiple images', async () => {
    mockDbState.staleImages = [
      { imageId: 10, listingId: 1000, localPathOriginal: 'originals/craigslist/1000/0.jpg', localPathResized: 'resized/craigslist/1000/0.webp', fileSizeBytes: 50000 },
      { imageId: 11, listingId: 1000, localPathOriginal: 'originals/craigslist/1000/1.jpg', localPathResized: 'resized/craigslist/1000/1.webp', fileSizeBytes: 60000 },
      { imageId: 12, listingId: 2000, localPathOriginal: 'originals/offerup/2000/0.jpg', localPathResized: null, fileSizeBytes: 40000 },
    ];

    const result = await cleanupOrphanedImages();
    expect(result.filesDeleted).toBe(5); // 2+2+1
    expect(result.listingsCleaned).toBe(2); // listing 1000 and 2000

    // Verify all 5 file paths
    expect(fsOps.unlinked).toHaveLength(5);
    expect(fsOps.unlinked).toContain('/app/data/images/originals/craigslist/1000/0.jpg');
    expect(fsOps.unlinked).toContain('/app/data/images/resized/craigslist/1000/0.webp');
    expect(fsOps.unlinked).toContain('/app/data/images/originals/craigslist/1000/1.jpg');
    expect(fsOps.unlinked).toContain('/app/data/images/resized/craigslist/1000/1.webp');
    expect(fsOps.unlinked).toContain('/app/data/images/originals/offerup/2000/0.jpg');
  });

  it('records DB update to null paths and mark cleaned', async () => {
    mockDbState.staleImages = [
      {
        imageId: 50,
        listingId: 500,
        localPathOriginal: 'originals/craigslist/500/0.jpg',
        localPathResized: null,
        fileSizeBytes: 25000,
      },
    ];

    await cleanupOrphanedImages();
    // Verify the update was called with the right payload
    expect(dbUpdates.length).toBeGreaterThan(0);
    const update = dbUpdates[0];
    expect(update.set.localPathOriginal).toBeNull();
    expect(update.set.localPathResized).toBeNull();
    expect(update.set.downloadStatus).toBe('cleaned');
  });
});
