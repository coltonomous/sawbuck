import logger from '../lib/logger.js';
import { agentConfig } from './config.js';

export class CaptchaDetectedError extends Error {
  constructor() {
    super('CAPTCHA detected — aborting scraping for this run');
    this.name = 'CaptchaDetectedError';
  }
}

export class DailyCapExceededError extends Error {
  constructor(count: number, cap: number) {
    super(`Daily request cap exceeded: ${count}/${cap}`);
    this.name = 'DailyCapExceededError';
  }
}

const BLOCK_PATTERNS = [
  /unusual traffic/i,
  /are you a robot/i,
  /verify you are human/i,
  /captcha/i,
  /access denied/i,
  /please try again later/i,
];

export interface AntiBlockingState {
  requestCount: number;
  errorsEncountered: number;
  backoffUntil: number | null;
  captchaDetected: boolean;
  lastRequestAt: number;
}

export class AntiBlockingController {
  private requestCount = 0;
  private errorsInWindow = 0;
  private backoffUntil: number | null = null;
  private lastRequestAt = 0;
  private captchaDetected = false;

  private readonly dailyCap: number;
  private readonly minDelay: number;
  private readonly maxDelay: number;
  private readonly backoffBase: number;
  private readonly backoffMax: number;

  constructor(config?: Partial<typeof agentConfig>) {
    this.dailyCap = config?.dailyRequestCap ?? agentConfig.dailyRequestCap;
    this.minDelay = config?.minDelayBetweenRequestsMs ?? agentConfig.minDelayBetweenRequestsMs;
    this.maxDelay = config?.maxDelayBetweenRequestsMs ?? agentConfig.maxDelayBetweenRequestsMs;
    this.backoffBase = config?.backoffBaseMs ?? agentConfig.backoffBaseMs;
    this.backoffMax = config?.backoffMaxMs ?? agentConfig.backoffMaxMs;
  }

  async beforeRequest(): Promise<void> {
    if (this.captchaDetected) {
      throw new CaptchaDetectedError();
    }

    if (this.requestCount >= this.dailyCap) {
      throw new DailyCapExceededError(this.requestCount, this.dailyCap);
    }

    // Wait for backoff period if active
    if (this.backoffUntil && Date.now() < this.backoffUntil) {
      const waitMs = this.backoffUntil - Date.now();
      logger.info({ waitMs }, 'Anti-blocking: waiting for backoff period');
      await sleep(waitMs);
    }

    // Enforce minimum delay between requests (jittered)
    const elapsed = Date.now() - this.lastRequestAt;
    const requiredDelay = this.minDelay + Math.random() * (this.maxDelay - this.minDelay);
    if (this.lastRequestAt > 0 && elapsed < requiredDelay) {
      await sleep(requiredDelay - elapsed);
    }

    this.lastRequestAt = Date.now();
    this.requestCount++;
  }

  onSuccess(): void {
    this.errorsInWindow = 0;
    this.backoffUntil = null;
  }

  onError(error: unknown): void {
    this.errorsInWindow++;
    const backoffMs = Math.min(
      this.backoffBase * Math.pow(2, this.errorsInWindow - 1),
      this.backoffMax,
    );
    const jitter = Math.random() * 5000;
    this.backoffUntil = Date.now() + backoffMs + jitter;
    logger.warn(
      { errorsInWindow: this.errorsInWindow, backoffMs: backoffMs + jitter, error: String(error) },
      'Anti-blocking: backoff activated',
    );
  }

  onCaptchaDetected(): void {
    this.captchaDetected = true;
    logger.error('Anti-blocking: CAPTCHA detected — aborting all scraping for this run');
  }

  checkForBlock(pageContent: string, statusCode?: number): boolean {
    if (statusCode === 403 || statusCode === 429) return true;
    return BLOCK_PATTERNS.some((p) => p.test(pageContent));
  }

  getState(): AntiBlockingState {
    return {
      requestCount: this.requestCount,
      errorsEncountered: this.errorsInWindow,
      backoffUntil: this.backoffUntil,
      captchaDetected: this.captchaDetected,
      lastRequestAt: this.lastRequestAt,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
