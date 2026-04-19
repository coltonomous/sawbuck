import logger from './logger.js';

// Vars that MUST be set in production for the server to function correctly.
// - DATABASE_URL: every DB query depends on it.
// - BETTER_AUTH_SECRET: required for session signing. If unset, auth silently
//   falls back to a weak default and sessions break on restart.
// - AWS_REGION: Bedrock (LLM) + S3 (images) clients need it.
// - S3_BUCKET: concept render + listing image uploads target this bucket.
// - FAL_KEY: concept render endpoint refuses to operate without it (503).
const REQUIRED_ENV_PROD = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'AWS_REGION',
  'S3_BUCKET',
  'FAL_KEY',
] as const;

// In dev/test we only require DATABASE_URL + BETTER_AUTH_SECRET — it is normal
// to run locally without AWS or fal.ai credentials.
const REQUIRED_ENV_NON_PROD = ['DATABASE_URL', 'BETTER_AUTH_SECRET'] as const;

export interface EnvCheckOptions {
  nodeEnv?: string;
  env?: NodeJS.ProcessEnv;
  exit?: (code: number) => never;
}

export function assertRequiredEnv(opts: EnvCheckOptions = {}): void {
  const nodeEnv = opts.nodeEnv ?? process.env.NODE_ENV;
  const env = opts.env ?? process.env;
  const exit = opts.exit ?? ((code: number) => process.exit(code) as never);

  const required = nodeEnv === 'production' ? REQUIRED_ENV_PROD : REQUIRED_ENV_NON_PROD;
  const missing = required.filter((k) => !env[k] || env[k]!.trim() === '');

  if (missing.length === 0) return;

  const msg = `Missing required env vars: ${missing.join(', ')}. Refusing to start (NODE_ENV=${nodeEnv ?? 'unset'}).`;
  // Log via pino so the failure shows up in CloudWatch alongside startup lines.
  logger.fatal({ missing, nodeEnv }, msg);
  // Also write to stderr directly — if logger transport is misconfigured the
  // fatal() above may be silently dropped.
  console.error(msg);
  exit(1);
}
