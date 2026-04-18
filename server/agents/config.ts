import { db } from '../db/index.js';
import { appSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import logger from '../lib/logger.js';

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

// Resolution order: DB setting → env var → hardcoded default
function resolve(dbKey: string, envKey: string, fallback: string): string {
  return cached(dbKey) || process.env[envKey] || fallback;
}

function resolveInt(dbKey: string, envKey: string, fallback: number): number {
  const val = cached(dbKey) || process.env[envKey];
  return val ? parseInt(val, 10) : fallback;
}

function resolveFloat(dbKey: string, envKey: string, fallback: number): number {
  const val = cached(dbKey) || process.env[envKey];
  return val ? parseFloat(val) : fallback;
}

/** Refresh the settings cache. Called by scheduler before each run. */
export async function refreshAgentConfig(): Promise<void> {
  await refreshCache();
}

/** Get current agent config (reads from cache, fast). */
export function getAgentConfig() {
  return {
    // Per-run caps
    maxTriages: resolveInt('agent.max_triages', 'AGENT_MAX_TRIAGES', 50),
    maxEvals: resolveInt('agent.max_evals', 'AGENT_MAX_EVALS', 10),
    // Quality gates
    triageConfidenceThreshold: resolveFloat('agent.triage_threshold', 'AGENT_TRIAGE_THRESHOLD', 0.75),
    dealScoreThreshold: resolveFloat('agent.deal_score_threshold', 'AGENT_DEAL_SCORE_THRESHOLD', 1.3),
    flipRecommendationThreshold: ['strong_buy', 'buy'] as const,

    // Anti-blocking
    minDelayBetweenRequestsMs: resolveInt('agent.min_delay_ms', 'AGENT_MIN_DELAY_MS', 1500),
    maxDelayBetweenRequestsMs: resolveInt('agent.max_delay_ms', 'AGENT_MAX_DELAY_MS', 4000),
    backoffBaseMs: 30_000,
    backoffMaxMs: 600_000,
    dailyRequestCap: resolveInt('agent.daily_request_cap', 'AGENT_DAILY_REQUEST_CAP', 200),

    // Scheduling
    cronSchedule: resolve('agent.cron_schedule', 'AGENT_CRON_SCHEDULE', '0 */4 * * *'),

    // Target
    targetCity: resolve('agent.target_city', 'AGENT_TARGET_CITY', 'seattle'),

    // Models
    triageModel: resolve('agent.triage_model', 'AGENT_TRIAGE_MODEL', 'qwen.qwen3-32b-v1:0'),
    evaluationModel: resolve('agent.eval_model', 'AGENT_EVAL_MODEL', 'qwen.qwen3-vl-235b-a22b'),

    // fal.ai
    conceptEditModel: resolve('agent.concept_edit_model', 'AGENT_CONCEPT_EDIT_MODEL', 'fal-ai/flux-kontext/dev'),
    conceptRenderSize: resolveInt('agent.concept_size', 'AGENT_CONCEPT_SIZE', 768),

    // RAG knowledge base bounds (per-type chunk limit)
    ragMaxChunksPerType: resolveInt('rag.max_chunks_per_type', 'RAG_MAX_CHUNKS_PER_TYPE', 500),

    // Listing cleanup — agent-discovered listings older than this are deleted
    listingMaxAgeDays: resolveInt('agent.listing_max_age_days', 'AGENT_LISTING_MAX_AGE_DAYS', 30),
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
