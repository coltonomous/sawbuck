function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

function envFloat(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseFloat(val) : fallback;
}

function envStr(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const agentConfig = {
  // Per-run caps
  maxHaikuTriages: envInt('AGENT_MAX_TRIAGES', 50),
  maxSonnetEvals: envInt('AGENT_MAX_EVALS', 10),
  maxListingsRendered: envInt('AGENT_MAX_RENDERS', 5),
  conceptsPerListing: envInt('AGENT_CONCEPTS_PER_LISTING', 1),

  // Quality gates
  triageConfidenceThreshold: envFloat('AGENT_TRIAGE_THRESHOLD', 0.6),
  dealScoreThreshold: envFloat('AGENT_DEAL_SCORE_THRESHOLD', 1.3),
  flipRecommendationThreshold: ['strong_buy', 'buy'] as const,

  // Anti-blocking (for detail page fetches)
  minDelayBetweenRequestsMs: envInt('AGENT_MIN_DELAY_MS', 1500),
  maxDelayBetweenRequestsMs: envInt('AGENT_MAX_DELAY_MS', 4000),
  backoffBaseMs: 30_000,
  backoffMaxMs: 600_000,
  dailyRequestCap: envInt('AGENT_DAILY_REQUEST_CAP', 200),

  // Scheduling
  runIntervalMs: envInt('AGENT_RUN_INTERVAL_MS', 4 * 60 * 60 * 1000), // 4 hours = 6 runs/day

  // Target
  targetCity: envStr('AGENT_TARGET_CITY', 'seattle'),

  // Models — defaults to Qwen on Bedrock
  triageModel: envStr('AGENT_TRIAGE_MODEL', 'qwen.qwen3-32b'),
  evaluationModel: envStr('AGENT_EVAL_MODEL', 'qwen.qwen3-vl-235b-a22b'),

  // fal.ai
  falModel: envStr('AGENT_FAL_MODEL', 'fal-ai/flux/dev'),
  conceptRenderSize: envInt('AGENT_CONCEPT_SIZE', 768),

  // Image retention
  agentImageRetentionDays: envInt('AGENT_IMAGE_RETENTION_DAYS', 14),
};
