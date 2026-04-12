import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AntiBlockingController, CaptchaDetectedError, DailyCapExceededError } from '../anti-blocking.js';

describe('AntiBlockingController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('enforces minimum delay between requests', async () => {
    const controller = new AntiBlockingController({
      minDelayBetweenRequestsMs: 100,
      maxDelayBetweenRequestsMs: 100, // fixed for test
      dailyRequestCap: 1000,
    });

    await controller.beforeRequest();
    const start = Date.now();

    const promise = controller.beforeRequest();
    // Advance timers to let the delay resolve
    await vi.advanceTimersByTimeAsync(200);
    await promise;

    expect(Date.now() - start).toBeGreaterThanOrEqual(100);
  });

  it('throws DailyCapExceededError when cap is reached', async () => {
    const controller = new AntiBlockingController({
      dailyRequestCap: 2,
      minDelayBetweenRequestsMs: 0,
      maxDelayBetweenRequestsMs: 0,
    });

    await controller.beforeRequest();
    await controller.beforeRequest();

    await expect(controller.beforeRequest()).rejects.toThrow(DailyCapExceededError);
  });

  it('throws CaptchaDetectedError after captcha is flagged', async () => {
    const controller = new AntiBlockingController({
      dailyRequestCap: 1000,
      minDelayBetweenRequestsMs: 0,
      maxDelayBetweenRequestsMs: 0,
    });

    controller.onCaptchaDetected();

    await expect(controller.beforeRequest()).rejects.toThrow(CaptchaDetectedError);
  });

  it('applies exponential backoff on errors', () => {
    const controller = new AntiBlockingController({
      backoffBaseMs: 1000,
      backoffMaxMs: 10000,
    });

    // First error: ~1000ms backoff
    controller.onError(new Error('timeout'));
    let state = controller.getState();
    expect(state.backoffUntil).not.toBeNull();
    const backoff1 = state.backoffUntil! - Date.now();
    expect(backoff1).toBeGreaterThanOrEqual(1000);
    expect(backoff1).toBeLessThanOrEqual(6000); // 1000 + up to 5000 jitter

    // Second error: ~2000ms backoff
    controller.onError(new Error('timeout'));
    state = controller.getState();
    const backoff2 = state.backoffUntil! - Date.now();
    expect(backoff2).toBeGreaterThanOrEqual(2000);

    // Third error: ~4000ms backoff
    controller.onError(new Error('timeout'));
    state = controller.getState();
    const backoff3 = state.backoffUntil! - Date.now();
    expect(backoff3).toBeGreaterThanOrEqual(4000);
  });

  it('caps backoff at backoffMaxMs', () => {
    const controller = new AntiBlockingController({
      backoffBaseMs: 1000,
      backoffMaxMs: 5000,
    });

    // Trigger many errors to exceed max
    for (let i = 0; i < 10; i++) {
      controller.onError(new Error('timeout'));
    }

    const state = controller.getState();
    const backoff = state.backoffUntil! - Date.now();
    // Should be capped at 5000 + jitter (max 5000)
    expect(backoff).toBeLessThanOrEqual(10000);
  });

  it('resets error window on success', () => {
    const controller = new AntiBlockingController({
      backoffBaseMs: 1000,
      backoffMaxMs: 600_000,
    });

    controller.onError(new Error('timeout'));
    controller.onError(new Error('timeout'));
    expect(controller.getState().errorsEncountered).toBe(2);

    controller.onSuccess();
    expect(controller.getState().errorsEncountered).toBe(0);
    expect(controller.getState().backoffUntil).toBeNull();
  });

  describe('checkForBlock', () => {
    it('detects 403 status', () => {
      const controller = new AntiBlockingController();
      expect(controller.checkForBlock('', 403)).toBe(true);
    });

    it('detects 429 status', () => {
      const controller = new AntiBlockingController();
      expect(controller.checkForBlock('', 429)).toBe(true);
    });

    it('detects "unusual traffic" text', () => {
      const controller = new AntiBlockingController();
      expect(controller.checkForBlock('We detected unusual traffic from your network')).toBe(true);
    });

    it('detects CAPTCHA indicators', () => {
      const controller = new AntiBlockingController();
      expect(controller.checkForBlock('<div id="captcha">Solve this</div>')).toBe(true);
    });

    it('detects "are you a robot" text', () => {
      const controller = new AntiBlockingController();
      expect(controller.checkForBlock('Are you a robot? Please verify.')).toBe(true);
    });

    it('returns false for normal page content', () => {
      const controller = new AntiBlockingController();
      expect(controller.checkForBlock('<html><body>Normal furniture listing page</body></html>')).toBe(false);
    });
  });

  it('tracks request count correctly', async () => {
    const controller = new AntiBlockingController({
      dailyRequestCap: 100,
      minDelayBetweenRequestsMs: 0,
      maxDelayBetweenRequestsMs: 0,
    });

    await controller.beforeRequest();
    await controller.beforeRequest();
    await controller.beforeRequest();

    expect(controller.getState().requestCount).toBe(3);
  });
});
