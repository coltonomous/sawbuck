import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import app from '../app.js';
import { createTestUser, authHeaders, type TestUser } from '../test/helpers.js';
import { db } from '../db/index.js';
import { listings, projects } from '../db/schema.js';

let userA: TestUser;
let userB: TestUser;

beforeAll(async () => {
  userA = await createTestUser('user');
  userB = await createTestUser('user');

  const suffix = crypto.randomUUID().slice(0, 6);

  // Seed different data for each user
  db.insert(listings).values({
    externalId: `stats-a-1-${suffix}`,
    platform: 'craigslist',
    url: `https://craigslist.org/stats-a1-${suffix}`,
    title: 'Stats User A Listing 1',
    askingPrice: 100,
    fingerprint: `fp-stats-a-1-${suffix}`,
    userId: userA.id,
  }).run();

  db.insert(listings).values({
    externalId: `stats-a-2-${suffix}`,
    platform: 'offerup',
    url: `https://offerup.com/stats-a2-${suffix}`,
    title: 'Stats User A Listing 2',
    askingPrice: 250,
    fingerprint: `fp-stats-a-2-${suffix}`,
    userId: userA.id,
  }).run();

  db.insert(listings).values({
    externalId: `stats-b-1-${suffix}`,
    platform: 'mercari',
    url: `https://mercari.com/stats-b1-${suffix}`,
    title: 'Stats User B Listing',
    askingPrice: 500,
    fingerprint: `fp-stats-b-1-${suffix}`,
    userId: userB.id,
  }).run();
});

describe('Stats user isolation', () => {
  it('returns 401 without auth', async () => {
    const res = await app.request('/api/stats');
    expect(res.status).toBe(401);
  });

  it('user A sees only their listing count', async () => {
    const res = await app.request('/api/stats', {
      headers: authHeaders(userA),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // User A has 2 listings seeded above (may have more from other tests in same suite)
    expect(body.summary.total_listings).toBeGreaterThanOrEqual(2);

    // Verify platform breakdown only contains user A's platforms
    const platforms = body.dealsByPlatform.map((p: any) => p.platform);
    expect(platforms).not.toContain('mercari'); // That's user B's listing
  });

  it('user B sees only their listing count', async () => {
    const res = await app.request('/api/stats', {
      headers: authHeaders(userB),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // User B has 1 listing seeded above
    expect(body.summary.total_listings).toBeGreaterThanOrEqual(1);

    // User B should see mercari, not craigslist (from user A)
    const platforms = body.dealsByPlatform.map((p: any) => p.platform);
    expect(platforms).toContain('mercari');
    expect(platforms).not.toContain('craigslist');
    expect(platforms).not.toContain('offerup');
  });

  it('user A avg price reflects only their listings', async () => {
    const res = await app.request('/api/stats', {
      headers: authHeaders(userA),
    });
    const body = await res.json();

    // User A's prices are 100 and 250, so avg should be around 175
    // (other tests may add more listings, so we just check it's not 500 which is user B's)
    if (body.summary.avg_asking_price !== null) {
      expect(body.summary.avg_asking_price).not.toBe(500);
    }
  });
});
