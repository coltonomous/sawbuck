import { describe, it, expect } from 'vitest';
import { fingerprint } from './manager.js';

describe('fingerprint', () => {
  it('produces consistent hash for same input', () => {
    const listing = {
      platform: 'craigslist',
      title: 'Vintage Dresser',
      askingPrice: 150,
      location: 'San Francisco',
    };
    const fp1 = fingerprint(listing as any);
    const fp2 = fingerprint(listing as any);
    expect(fp1).toBe(fp2);
  });

  it('normalizes case', () => {
    const upper = fingerprint({
      platform: 'craigslist',
      title: 'VINTAGE DRESSER',
      askingPrice: 150,
      location: 'San Francisco',
    } as any);
    const lower = fingerprint({
      platform: 'craigslist',
      title: 'vintage dresser',
      askingPrice: 150,
      location: 'San Francisco',
    } as any);
    expect(upper).toBe(lower);
  });

  it('produces different hash for different platforms', () => {
    const base = { title: 'Dresser', askingPrice: 100, location: 'LA' };
    const fp1 = fingerprint({ ...base, platform: 'craigslist' } as any);
    const fp2 = fingerprint({ ...base, platform: 'offerup' } as any);
    expect(fp1).not.toBe(fp2);
  });

  it('handles null price and location', () => {
    const listing = {
      platform: 'craigslist',
      title: 'Dresser',
      askingPrice: null,
      location: null,
    };
    expect(() => fingerprint(listing as any)).not.toThrow();
  });

  it('trims whitespace', () => {
    const fp1 = fingerprint({
      platform: 'craigslist',
      title: '  Dresser  ',
      askingPrice: 100,
      location: '  LA  ',
    } as any);
    const fp2 = fingerprint({
      platform: 'craigslist',
      title: 'Dresser',
      askingPrice: 100,
      location: 'LA',
    } as any);
    expect(fp1).toBe(fp2);
  });
});
