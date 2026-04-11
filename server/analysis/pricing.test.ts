import { describe, it, expect } from 'vitest';
import { median, conditionMultiplier } from './pricing.js';

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
