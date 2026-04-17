import { describe, it, expect } from 'vitest';
import { cleanupOrphanedImages } from './cleanup.js';

describe('cleanupOrphanedImages', () => {
  it('is a no-op that returns zero counts (image retention disabled)', async () => {
    const result = await cleanupOrphanedImages();
    expect(result.filesDeleted).toBe(0);
    expect(result.bytesFreed).toBe(0);
    expect(result.listingsCleaned).toBe(0);
  });
});
