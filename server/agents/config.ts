function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

function envStr(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const agentConfig = {
  // Per-run caps
  maxHaikuTriages: envInt('AGENT_MAX_HAIKU_TRIAGES', 50),
  maxSonnetEvals: envInt('AGENT_MAX_SONNET_EVALS', 15),
  maxListingsRendered: envInt('AGENT_MAX_LISTINGS_RENDERED', 5),
  conceptsPerListing: envInt('AGENT_CONCEPTS_PER_LISTING', 3),

  // Quality gates
  triageConfidenceThreshold: 0.6,
  dealScoreThreshold: 1.3,
  flipRecommendationThreshold: ['strong_buy', 'buy'] as const,

  // Anti-blocking (for detail page fetches)
  minDelayBetweenRequestsMs: 1500,
  maxDelayBetweenRequestsMs: 4000,
  backoffBaseMs: 30_000,
  backoffMaxMs: 600_000,
  dailyRequestCap: envInt('AGENT_DAILY_REQUEST_CAP', 200),

  // Scheduling
  runIntervalMs: envInt('AGENT_RUN_INTERVAL_MS', 3 * 60 * 60 * 1000),

  // Target
  targetCity: envStr('AGENT_TARGET_CITY', 'seattle'),

  // Models
  triageModel: envStr('AGENT_TRIAGE_MODEL', 'claude-haiku-4-5-20251001') as 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-20250514',
  evaluationModel: envStr('AGENT_EVAL_MODEL', 'claude-sonnet-4-20250514') as 'claude-sonnet-4-20250514' | 'claude-haiku-4-5-20251001',

  // fal.ai
  falModel: envStr('AGENT_FAL_MODEL', 'fal-ai/flux/dev'),
  conceptRenderSize: 768,

  // Image retention
  agentImageRetentionDays: envInt('AGENT_IMAGE_RETENTION_DAYS', 14),
};
