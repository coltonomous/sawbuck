/**
 * Central environment configuration — validated once at import time.
 *
 * Resolution: process.env → defaults. All env reads happen here;
 * the rest of the codebase imports `env` instead of touching process.env.
 *
 * Agent-specific settings that support runtime DB overrides live in
 * agents/config.ts and use these values as their fallback defaults.
 */

import { z } from 'zod';

const envSchema = z.object({
  // ── Node ──────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),

  // ── Database ──────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // ── Auth ──────────────────────────────────────────────────────────
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url().optional(),
  ADMIN_EMAIL: z.string().email().optional(),

  // ── Google OAuth (optional pair — both or neither) ────────────────
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // ── CORS ──────────────────────────────────────────────────────────
  CORS_ORIGIN: z.string().optional(),

  // ── AWS / Bedrock ─────────────────────────────────────────────────
  AWS_REGION: z.string().optional(),
  AWS_DEFAULT_REGION: z.string().optional(),

  // ── AI models (env-level defaults, overridable via DB) ────────────
  AGENT_EVAL_MODEL: z.string().default('qwen.qwen3-vl-235b-a22b'),
  AGENT_TRIAGE_MODEL: z.string().default('qwen.qwen3-32b-v1:0'),
  AGENT_FAL_MODEL: z.string().default('fal-ai/flux/dev'),

  // ── Agent pipeline (env-level defaults, overridable via DB) ───────
  AGENT_MAX_TRIAGES: z.coerce.number().int().positive().optional(),
  AGENT_MAX_EVALS: z.coerce.number().int().positive().optional(),
  AGENT_TRIAGE_THRESHOLD: z.coerce.number().optional(),
  AGENT_DEAL_SCORE_THRESHOLD: z.coerce.number().optional(),
  AGENT_MIN_DELAY_MS: z.coerce.number().int().optional(),
  AGENT_MAX_DELAY_MS: z.coerce.number().int().optional(),
  AGENT_DAILY_REQUEST_CAP: z.coerce.number().int().optional(),
  AGENT_RUN_INTERVAL_MS: z.coerce.number().int().optional(),
  AGENT_TARGET_CITY: z.string().optional(),
  AGENT_CONCEPT_SIZE: z.coerce.number().int().optional(),
  AGENT_IMAGE_RETENTION_DAYS: z.coerce.number().int().optional(),
  RAG_MAX_CHUNKS_PER_TYPE: z.coerce.number().int().optional(),

  // ── Third-party APIs (optional) ───────────────────────────────────
  EBAY_CLIENT_ID: z.string().optional(),
  EBAY_CLIENT_SECRET: z.string().optional(),
  FAL_KEY: z.string().optional(),
}).superRefine((data, ctx) => {
  // Google OAuth: require both or neither
  const hasId = !!data.GOOGLE_CLIENT_ID;
  const hasSecret = !!data.GOOGLE_CLIENT_SECRET;
  if (hasId !== hasSecret) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set or both be omitted',
      path: [hasId ? 'GOOGLE_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID'],
    });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  console.error(`\nEnvironment validation failed:\n${formatted}\n`);
  process.exit(1);
}

const data = parsed.data;

/** Validated, typed environment config. Import this instead of using process.env. */
export const env = {
  // Node
  nodeEnv: data.NODE_ENV,
  isProd: data.NODE_ENV === 'production',
  isTest: data.NODE_ENV === 'test',
  port: data.PORT,
  logLevel: data.LOG_LEVEL ?? (data.NODE_ENV === 'production' ? 'info' : 'debug'),

  // Database
  databaseUrl: data.DATABASE_URL,

  // Auth
  betterAuthSecret: data.BETTER_AUTH_SECRET,
  betterAuthUrl: data.BETTER_AUTH_URL,
  adminEmail: data.ADMIN_EMAIL,

  // Google OAuth
  googleClientId: data.GOOGLE_CLIENT_ID,
  googleClientSecret: data.GOOGLE_CLIENT_SECRET,
  hasGoogleOAuth: !!(data.GOOGLE_CLIENT_ID && data.GOOGLE_CLIENT_SECRET),

  // CORS
  corsOrigin: data.CORS_ORIGIN,

  // AWS
  awsRegion: data.AWS_REGION ?? data.AWS_DEFAULT_REGION,
  hasAws: !!(data.AWS_REGION || data.AWS_DEFAULT_REGION),

  // AI models (env defaults — agents/config.ts overlays DB values on top)
  agentEvalModel: data.AGENT_EVAL_MODEL,
  agentTriageModel: data.AGENT_TRIAGE_MODEL,
  agentFalModel: data.AGENT_FAL_MODEL,

  // Agent pipeline defaults
  agentMaxTriages: data.AGENT_MAX_TRIAGES,
  agentMaxEvals: data.AGENT_MAX_EVALS,
  agentTriageThreshold: data.AGENT_TRIAGE_THRESHOLD,
  agentDealScoreThreshold: data.AGENT_DEAL_SCORE_THRESHOLD,
  agentMinDelayMs: data.AGENT_MIN_DELAY_MS,
  agentMaxDelayMs: data.AGENT_MAX_DELAY_MS,
  agentDailyRequestCap: data.AGENT_DAILY_REQUEST_CAP,
  agentRunIntervalMs: data.AGENT_RUN_INTERVAL_MS,
  agentTargetCity: data.AGENT_TARGET_CITY,
  agentConceptSize: data.AGENT_CONCEPT_SIZE,
  agentImageRetentionDays: data.AGENT_IMAGE_RETENTION_DAYS,
  ragMaxChunksPerType: data.RAG_MAX_CHUNKS_PER_TYPE,

  // Third-party APIs
  ebayClientId: data.EBAY_CLIENT_ID,
  ebayClientSecret: data.EBAY_CLIENT_SECRET,
  hasEbay: !!(data.EBAY_CLIENT_ID && data.EBAY_CLIENT_SECRET),
  falKey: data.FAL_KEY,
  hasFal: !!data.FAL_KEY,
} as const;
