import { describe, it, expect } from 'vitest';
import { median, conditionMultiplier, removeOutliers } from './pricing.js';

describe('median', () => {
  it('returns 0 for empty array', () => {
    expect(median([])).toBe(0);
  });

  it('returns the single value for one element', () => {
    expect(median([42])).toBe(42);
  });

  it('returns middle value for odd-length array', () => {
    expect(median([10, 20, 30])).toBe(20);
  });

  it('returns average of two middle values for even-length array', () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it('handles unsorted input', () => {
    expect(median([30, 10, 20])).toBe(20);
  });

  it('handles duplicate values', () => {
    expect(median([5, 5, 5, 5])).toBe(5);
  });

  it('handles two elements', () => {
    expect(median([10, 30])).toBe(20);
  });
});

describe('conditionMultiplier', () => {
  it('returns 1.0 for condition score 8 (baseline)', () => {
    expect(conditionMultiplier(8)).toBe(1.0);
  });

  it('returns higher multiplier above 8 (+0.05 per point)', () => {
    expect(conditionMultiplier(9)).toBe(1.05);
    expect(conditionMultiplier(10)).toBe(1.1);
  });

  it('caps at 1.2', () => {
    expect(conditionMultiplier(12)).toBe(1.2);
  });

  it('returns lower multiplier below 8 (-0.1 per point)', () => {
    expect(conditionMultiplier(7)).toBe(0.9);
    expect(conditionMultiplier(6)).toBe(0.8);
    expect(conditionMultiplier(5)).toBe(0.7);
  });

  it('floors at 0.3', () => {
    expect(conditionMultiplier(1)).toBe(0.3);
    expect(conditionMultiplier(0)).toBe(0.3);
  });

  it('defaults to score 5 when null', () => {
    expect(conditionMultiplier(null)).toBe(0.7);
  });

  it('handles fractional scores', () => {
    expect(conditionMultiplier(8.5)).toBe(1.025);
  });
});

describe('removeOutliers', () => {
  it('returns as-is for fewer than 4 values', () => {
    expect(removeOutliers([10, 20, 30])).toEqual([10, 20, 30]);
  });

  it('removes extreme high outlier', () => {
    const prices = [50, 55, 60, 65, 70, 10000];
    const filtered = removeOutliers(prices);
    expect(filtered).not.toContain(10000);
    expect(filtered.length).toBe(5);
  });

  it('removes extreme low outlier', () => {
    const prices = [1, 200, 220, 240, 260, 280];
    const filtered = removeOutliers(prices);
    expect(filtered).not.toContain(1);
  });

  it('keeps values within normal range', () => {
    const prices = [100, 120, 130, 140, 150, 160];
    const filtered = removeOutliers(prices);
    expect(filtered).toEqual([100, 120, 130, 140, 150, 160]);
  });

  it('handles all same values', () => {
    const prices = [50, 50, 50, 50];
    expect(removeOutliers(prices)).toEqual([50, 50, 50, 50]);
  });

  it('filters the $10k vs $50 scenario', () => {
    const prices = [40, 45, 50, 55, 60, 10000];
    const filtered = removeOutliers(prices);
    expect(filtered).not.toContain(10000);
    expect(median(filtered)).toBeLessThan(100);
  });
});
