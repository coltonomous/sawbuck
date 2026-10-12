import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import app from '../app.js';
import { createTestUser, authHeaders, type TestUser } from '../test/helpers.js';
import { db } from '../db/index.js';
import { listings } from '../db/schema.js';
import { eq } from 'drizzle-orm';

let userA: TestUser;
let userB: TestUser;
let suffix: string;

beforeAll(async () => {
  userA = await createTestUser('user');
  userB = await createTestUser('user');

  suffix = crypto.randomUUID().slice(0, 6);

  // Seed listings for each user
  await db.insert(listings).values({
    externalId: `test-a-${suffix}`,
    platform: 'craigslist',
    url: `https://craigslist.org/a-${suffix}`,
    title: `User A Dresser ${suffix}`,
    askingPrice: 100,
    fingerprint: `fp-a-${suffix}`,
    userId: userA.id,
  });

  await db.insert(listings).values({
    externalId: `test-b-${suffix}`,
    platform: 'craigslist',
    url: `https://craigslist.org/b-${suffix}`,
    title: `User B Table ${suffix}`,
    askingPrice: 200,
    fingerprint: `fp-b-${suffix}`,
    userId: userB.id,
  });
});

describe('GET /health', () => {
  it('returns ok without auth', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });
});

describe('Auth enforcement', () => {
  it('returns 401 for unauthenticated requests to /api/listings', async () => {
    const res = await app.request('/api/listings');
    expect(res.status).toBe(401);
  });

  it('returns 401 for unauthenticated requests to /api/stats', async () => {
    const res = await app.request('/api/stats');
    expect(res.status).toBe(401);
  });

  it('allows authenticated requests through', async () => {
    const res = await app.request('/api/listings?limit=5', {
      headers: authHeaders(userA),
    });
    expect(res.status).toBe(200);
  });
});

describe('User isolation', () => {
  it('user A only sees their own listings (plus sawbuck community listings)', async () => {
    // Filter to craigslist to avoid cross-test pollution from sawbuck listings
    const res = await app.request('/api/listings?limit=50&platform=craigslist', {
      headers: authHeaders(userA),
    });
    const body = await res.json();
    // All craigslist listings should belong to user A
    expect(body.listings.every((l: any) => l.userId === userA.id)).toBe(true);
    expect(body.listings.some((l: any) => l.title === `User A Dresser ${suffix}`)).toBe(true);
    expect(body.listings.some((l: any) => l.title === `User B Table ${suffix}`)).toBe(false);
  });

  it('user B only sees their own listings (plus sawbuck community listings)', async () => {
    const res = await app.request('/api/listings?limit=50&platform=craigslist', {
      headers: authHeaders(userB),
    });
    const body = await res.json();
    expect(body.listings.every((l: any) => l.userId === userB.id)).toBe(true);
    expect(body.listings.some((l: any) => l.title === `User B Table ${suffix}`)).toBe(true);
    expect(body.listings.some((l: any) => l.title === `User A Dresser ${suffix}`)).toBe(false);
  });

  it('user A cannot access user B listing by ID', async () => {
    const bRes = await app.request('/api/listings?limit=50&platform=craigslist', {
      headers: authHeaders(userB),
    });
    const bBody = await bRes.json();
    const bListing = bBody.listings.find((l: any) => l.userId === userB.id);
    if (!bListing) return;

    const res = await app.request(`/api/listings/${bListing.id}`, {
      headers: authHeaders(userA),
    });
    expect(res.status).toBe(404);
  });

  it('user A cannot bulk-update user B listings', async () => {
    const bRes = await app.request('/api/listings?limit=50&platform=craigslist', {
      headers: authHeaders(userB),
    });
    const bBody = await bRes.json();
    const bListingId = bBody.listings[0].id;

    const res = await app.request('/api/listings/bulk', {
      method: 'PATCH',
      headers: { ...authHeaders(userA), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [bListingId], updates: { status: 'dismissed' } }),
    });
    expect(res.status).toBe(200);

    // Verify B's listing is unchanged
    const checkRes = await app.request(`/api/listings/${bListingId}`, {
      headers: authHeaders(userB),
    });
    const checkBody = await checkRes.json();
    expect(checkBody.status).not.toBe('dismissed');
  });
});

describe('Listings CRUD with auth', () => {
  it('accepts sort parameters when authenticated', async () => {
    const res = await app.request('/api/listings?sort=askingPrice&sort_dir=asc&limit=5', {
      headers: authHeaders(userA),
    });
    expect(res.status).toBe(200);
  });

  it('accepts filter parameters when authenticated', async () => {
    const res = await app.request('/api/listings?platform=craigslist&status=new&limit=5', {
      headers: authHeaders(userA),
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent listing', async () => {
    const res = await app.request('/api/listings/999999', {
      headers: authHeaders(userA),
    });
    expect(res.status).toBe(404);
  });
});

describe('Importing a listing someone else already has', () => {
  let owner: TestUser;
  let importer: TestUser;
  let bystander: TestUser;
  let ownedId: number;
  let agentId: number;
  let ownedUrl: string;
  let agentUrl: string;
  let tag: string;

  const importAs = (user: TestUser, url: string) =>
    app.request('/api/listings/import', {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

  const feedIds = async (user: TestUser) => {
    const res = await app.request(`/api/listings?limit=50&search=${tag}`, { headers: authHeaders(user) });
    const body = await res.json();
    return body.listings.map((l: any) => l.id);
  };

  beforeAll(async () => {
    owner = await createTestUser('user');
    importer = await createTestUser('user');
    bystander = await createTestUser('user');
    tag = `imp${crypto.randomUUID().slice(0, 6)}`;
    const ownedExt = String(7_000_000_000 + Math.floor(Math.random() * 999_999_999));
    const agentExt = String(8_000_000_000 + Math.floor(Math.random() * 999_999_999));
    ownedUrl = `https://seattle.craigslist.org/see/fuo/d/dresser/${ownedExt}.html`;
    agentUrl = `https://seattle.craigslist.org/see/fuo/d/table/${agentExt}.html`;

    [{ id: ownedId }] = await db.insert(listings).values({
      externalId: ownedExt,
      platform: 'craigslist',
      url: ownedUrl,
      title: `Owned Dresser ${tag}`,
      userId: owner.id,
    }).returning({ id: listings.id });

    // Agent-discovered listing the pipeline passed on
    [{ id: agentId }] = await db.insert(listings).values({
      externalId: agentExt,
      platform: 'craigslist',
      url: agentUrl,
      title: `Passed Table ${tag}`,
      status: 'dismissed',
      furnitureType: 'table',
    }).returning({ id: listings.id });
  });

  it('keeps the original owner and gives the importer access', async () => {
    const res = await importAs(importer, ownedUrl);
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyExists).toBe(true);

    const [row] = await db.select().from(listings).where(eq(listings.id, ownedId));
    expect(row.userId).toBe(owner.id);

    expect((await app.request(`/api/listings/${ownedId}`, { headers: authHeaders(importer) })).status).toBe(200);
    expect((await app.request(`/api/listings/${ownedId}`, { headers: authHeaders(owner) })).status).toBe(200);
    expect(await feedIds(importer)).toContain(ownedId);
  });

  it('does not expose the listing to other users', async () => {
    expect((await app.request(`/api/listings/${ownedId}`, { headers: authHeaders(bystander) })).status).toBe(404);
    expect(await feedIds(bystander)).not.toContain(ownedId);
  });

  it('is idempotent when the same user imports twice', async () => {
    expect((await importAs(importer, ownedUrl)).status).toBe(200);
  });

  it('shows an agent-dismissed listing to the importer without restoring it for everyone', async () => {
    const res = await importAs(importer, agentUrl);
    expect(res.status).toBe(200);

    const [row] = await db.select().from(listings).where(eq(listings.id, agentId));
    expect(row.status).toBe('dismissed');
    expect(row.userId).toBeNull();

    expect(await feedIds(importer)).toContain(agentId);
    expect(await feedIds(bystander)).not.toContain(agentId);
  });

  it('still restores the importer\'s own dismissed listing', async () => {
    await db.update(listings).set({ status: 'dismissed' }).where(eq(listings.id, ownedId));

    expect((await importAs(owner, ownedUrl)).status).toBe(200);

    const [row] = await db.select().from(listings).where(eq(listings.id, ownedId));
    expect(row.status).toBe('new');
  });
});
