export const config = {
  images: {
    maxSizeBytes: 10 * 1024 * 1024, // 10 MB
    maxEdge: 1500,
    webpQuality: 85,
    downloadTimeoutMs: 15_000,
    retentionDays: 30,
  },
  ai: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxAnalysisImages: 3,
    maxTokens: 4000,
    // Default model — reads from agent config (DB-backed, env fallback)
    get model(): string {
      try {
        const { getAgentConfig } = require('../agents/config.js');
        return getAgentConfig().evaluationModel;
      } catch {
        return process.env.AGENT_EVAL_MODEL || 'qwen.qwen3-vl-235b-a22b';
      }
    },
  },
};
