import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./logger.js', () => ({
  default: { fatal: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { assertRequiredEnv } from './env.js';

const prodComplete = {
  DATABASE_URL: 'postgres://u:p@h/db',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  AWS_REGION: 'us-east-1',
  S3_BUCKET: 'bucket',
  FAL_KEY: 'fal-key',
};

let exitSpy: ReturnType<typeof vi.fn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  exitSpy = vi.fn();
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('assertRequiredEnv', () => {
  describe('in production', () => {
    it('returns silently when every required var is present', () => {
      assertRequiredEnv({ nodeEnv: 'production', env: prodComplete, exit: exitSpy as never });
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('exits(1) when FAL_KEY is missing (concept renders would 503 at runtime)', () => {
      const env = { ...prodComplete };
      delete (env as any).FAL_KEY;
      assertRequiredEnv({ nodeEnv: 'production', env, exit: exitSpy as never });
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits(1) when DATABASE_URL is missing', () => {
      const env = { ...prodComplete };
      delete (env as any).DATABASE_URL;
      assertRequiredEnv({ nodeEnv: 'production', env, exit: exitSpy as never });
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits(1) when BETTER_AUTH_SECRET is missing — sessions would use a weak fallback', () => {
      const env = { ...prodComplete };
      delete (env as any).BETTER_AUTH_SECRET;
      assertRequiredEnv({ nodeEnv: 'production', env, exit: exitSpy as never });
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('treats empty-string values as missing (whitespace is not a valid secret)', () => {
      const env = { ...prodComplete, AWS_REGION: '   ' };
      assertRequiredEnv({ nodeEnv: 'production', env, exit: exitSpy as never });
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('reports every missing var in the error message, not just the first one', () => {
      const env = { DATABASE_URL: 'x', BETTER_AUTH_SECRET: 'y' } as any;
      assertRequiredEnv({ nodeEnv: 'production', env, exit: exitSpy as never });
      expect(errSpy).toHaveBeenCalled();
      const msg = errSpy.mock.calls[0]![0] as string;
      expect(msg).toContain('AWS_REGION');
      expect(msg).toContain('S3_BUCKET');
      expect(msg).toContain('FAL_KEY');
    });
  });

  describe('outside production', () => {
    it('only requires DATABASE_URL + BETTER_AUTH_SECRET (no AWS/FAL needed for dev)', () => {
      const env = { DATABASE_URL: 'x', BETTER_AUTH_SECRET: 'y' };
      assertRequiredEnv({ nodeEnv: 'development', env, exit: exitSpy as never });
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('still exits when DATABASE_URL is missing', () => {
      assertRequiredEnv({ nodeEnv: 'development', env: { BETTER_AUTH_SECRET: 'y' }, exit: exitSpy as never });
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('does not require FAL_KEY in dev', () => {
      const env = { DATABASE_URL: 'x', BETTER_AUTH_SECRET: 'y' };
      assertRequiredEnv({ nodeEnv: undefined, env, exit: exitSpy as never });
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });
});
