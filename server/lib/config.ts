import { env } from './env.js';

// Lazy import to break circular dependency (config → agents/config → lib/logger → env)
let _getAgentConfig: (() => { evaluationModel: string }) | undefined;

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
    get model(): string {
      if (!_getAgentConfig) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          _getAgentConfig = (require('../agents/config.js') as { getAgentConfig: typeof _getAgentConfig }).getAgentConfig;
        } catch {
          return env.agentEvalModel;
        }
      }
      return _getAgentConfig!().evaluationModel;
    },
  },
};
