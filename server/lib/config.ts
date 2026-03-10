export const config = {
  browser: {
    maxConcurrent: 3,
    pageTimeoutMs: 45_000,
    poolSlotTimeoutMs: 60_000,
  },
  images: {
    maxSizeBytes: 10 * 1024 * 1024, // 10 MB
    maxEdge: 1500,
    webpQuality: 85,
    downloadTimeoutMs: 15_000,
  },
  claude: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxAnalysisImages: 3,
    maxTokens: 1500,
    model: 'claude-sonnet-4-20250514' as const,
  },
  scraper: {
    /** If a scraper returns fewer results than this, warn about possible selector breakage */
    minExpectedResults: 0,
    detailPageLimit: {
      craigslist: 5,
      mercari: 12,
    },
  },
} as const;
