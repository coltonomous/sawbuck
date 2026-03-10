import { describe, it, expect } from 'vitest';
import { fingerprint } from './manager.js';

describe('fingerprint', () => {
  it('produces a 32-character hex string (SHA-256 truncated)', () => {
    const fp = fingerprint({
      platform: 'craigslist',
      title: 'Mid Century Dresser',
      askingPrice: 150,
      location: 'San Francisco',
      externalId: '123',
      url: 'https://example.com',
      imageUrls: [],
    });
    expect(fp).toMatch(/^[a-f0-9]{32}$/);
  });

  it('produces same hash for same input', () => {
    const listing = {
      platform: 'offerup' as const,
      title: 'Vintage Chair',
      askingPrice: 50,
      location: 'Portland',
      externalId: '456',
      url: 'https://example.com',
      imageUrls: [],
    };
    expect(fingerprint(listing)).toBe(fingerprint(listing));
  });

  it('produces different hash for different titles', () => {
    const base = {
      platform: 'craigslist' as const,
      externalId: '1',
      url: 'https://example.com',
      imageUrls: [],
      askingPrice: 100,
      location: 'SF',
    };
    const fp1 = fingerprint({ ...base, title: 'Oak Desk' });
    const fp2 = fingerprint({ ...base, title: 'Walnut Desk' });
    expect(fp1).not.toBe(fp2);
  });

  it('is case-insensitive for title and location', () => {
    const base = {
      platform: 'mercari' as const,
      externalId: '1',
      url: 'https://example.com',
      imageUrls: [],
      askingPrice: 75,
    };
    const fp1 = fingerprint({ ...base, title: 'Dining Table', location: 'New York' });
    const fp2 = fingerprint({ ...base, title: 'dining table', location: 'new york' });
    expect(fp1).toBe(fp2);
  });
});
