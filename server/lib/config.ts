export const config = {
  images: {
    maxSizeBytes: 10 * 1024 * 1024, // 10 MB
    maxEdge: 1500,
    webpQuality: 85,
    downloadTimeoutMs: 15_000,
    retentionDays: 30,
  },
  claude: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxAnalysisImages: 3,
    maxTokens: 1500,
    model: 'claude-sonnet-4-20250514' as const,
  },
} as const;
