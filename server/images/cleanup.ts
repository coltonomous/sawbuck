export interface CleanupResult {
  filesDeleted: number;
  bytesFreed: number;
  listingsCleaned: number;
}

/**
 * Image retention is disabled — images are kept forever and cleaned up
 * when their parent listing is deleted (FK cascades handle DB rows,
 * the listing delete route handles files on disk).
 */
export async function cleanupOrphanedImages(): Promise<CleanupResult> {
  return { filesDeleted: 0, bytesFreed: 0, listingsCleaned: 0 };
}
