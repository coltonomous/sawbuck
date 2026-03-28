import logger from './logger.js';

export interface WithRetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  label?: string;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions,
): Promise<T> {
  const { maxRetries, baseDelayMs, label = 'retry' } = options;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status ?? err?.statusCode;
      const isRetryable = status === 429 || (status >= 500 && status < 600);
      if (!isRetryable || attempt === maxRetries - 1) throw err;

      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
      logger.warn({ label, attempt: attempt + 1, maxRetries, delayMs: Math.round(delay), status: status || err?.message }, 'Retrying after error');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Should not reach here');
}
