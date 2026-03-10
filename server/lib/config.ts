/**
 * Centralized configuration — replaces magic numbers scattered across the codebase.
 * All tunables live here so they're documented by name and changeable in one place.
 */
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
  pricing: {
    soldWeight: 0.7,
    activeWeight: 0.3,
    activeDiscount: 0.85,
    minSoldForSoldOnly: 3,
    conditionBaseline: 8,
    conditionAboveFactor: 0.05,
    conditionBelowFactor: 0.1,
    conditionMaxMultiplier: 1.2,
    conditionMinMultiplier: 0.3,
    refinishedConditionScore: 8.5,
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
