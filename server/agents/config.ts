import { db } from '../db/index.js';
import { appSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import logger from '../lib/logger.js';
import { env } from '../lib/env.js';

// In-memory cache of DB settings, refreshed periodically
let settingsCache: Map<string, string> = new Map();
let lastFetch = 0;
const CACHE_TTL_MS = 60_000; // re-read DB every 60s

async function refreshCache(): Promise<void> {
  try {
    const rows = await db.select().from(appSettings);
    settingsCache = new Map(rows.map((r) => [r.key, r.value]));
    lastFetch = Date.now();
  } catch {
    // DB not ready yet (startup) — use env/defaults
  }
}

function cached(key: string): string | undefined {
  return settingsCache.get(key);
}

// Resolution order: DB setting → validated env value → hardcoded default
function resolve(dbKey: string, envVal: string | undefined, fallback: string): string {
  return cached(dbKey) ?? envVal ?? fallback;
}

function resolveInt(dbKey: string, envVal: number | undefined, fallback: number): number {
  const dbVal = cached(dbKey);
  if (dbVal) return parseInt(dbVal, 10);
  return envVal ?? fallback;
}

function resolveFloat(dbKey: string, envVal: number | undefined, fallback: number): number {
  const dbVal = cached(dbKey);
  if (dbVal) return parseFloat(dbVal);
  return envVal ?? fallback;
}

/** Refresh the settings cache. Called by scheduler before each run. */
export async function refreshAgentConfig(): Promise<void> {
  await refreshCache();
}

/** Get current agent config (reads from cache, fast). */
export function getAgentConfig() {
  return {
    // Per-run caps
    maxTriages: resolveInt('agent.max_triages', env.agentMaxTriages, 50),
    maxEvals: resolveInt('agent.max_evals', env.agentMaxEvals, 10),
    // Quality gates
    triageConfidenceThreshold: resolveFloat('agent.triage_threshold', env.agentTriageThreshold, 0.75),
    dealScoreThreshold: resolveFloat('agent.deal_score_threshold', env.agentDealScoreThreshold, 1.3),
    flipRecommendationThreshold: ['strong_buy', 'buy'] as const,

    // Anti-blocking
    minDelayBetweenRequestsMs: resolveInt('agent.min_delay_ms', env.agentMinDelayMs, 1500),
    maxDelayBetweenRequestsMs: resolveInt('agent.max_delay_ms', env.agentMaxDelayMs, 4000),
    backoffBaseMs: 30_000,
    backoffMaxMs: 600_000,
    dailyRequestCap: resolveInt('agent.daily_request_cap', env.agentDailyRequestCap, 200),

    // Scheduling
    runIntervalMs: resolveInt('agent.run_interval_ms', env.agentRunIntervalMs, 4 * 60 * 60 * 1000),

    // Target
    targetCity: resolve('agent.target_city', env.agentTargetCity, 'seattle'),

    // Models
    triageModel: resolve('agent.triage_model', env.agentTriageModel, 'qwen.qwen3-32b-v1:0'),
    evaluationModel: resolve('agent.eval_model', env.agentEvalModel, 'qwen.qwen3-vl-235b-a22b'),

    // fal.ai
    falModel: resolve('agent.fal_model', env.agentFalModel, 'fal-ai/flux/dev'),
    conceptRenderSize: resolveInt('agent.concept_size', env.agentConceptSize, 768),

    // Image retention
    agentImageRetentionDays: resolveInt('agent.image_retention_days', env.agentImageRetentionDays, 14),

    // RAG knowledge base bounds (per-type chunk limit)
    ragMaxChunksPerType: resolveInt('rag.max_chunks_per_type', env.ragMaxChunksPerType, 500),
  };
}

// Live config — reads from DB cache on every property access
// so changes take effect without restart
type AgentConfig = ReturnType<typeof getAgentConfig>;

export const agentConfig = new Proxy({} as AgentConfig, {
  get: (_target, prop: string & keyof AgentConfig) => getAgentConfig()[prop],
});

/** Update a setting in the DB (called from admin API). */
export async function updateSetting(key: string, value: string): Promise<void> {
  await db.insert(appSettings).values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
  // Refresh cache immediately
  await refreshCache();
}

/** Delete a setting from the DB (revert to env/default). */
export async function deleteSetting(key: string): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, key));
  await refreshCache();
}

/** Get all settings from DB for admin display. */
export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(appSettings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
