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
    // Default model for vision analysis and general use
    // Override via AGENT_EVAL_MODEL env var in agent config
    model: process.env.AGENT_EVAL_MODEL || 'qwen.qwen3-vl-235b-a22b',
  },
};
