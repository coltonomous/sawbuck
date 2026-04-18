import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('../lib/s3.js', () => ({
  uploadToS3: vi.fn().mockResolvedValue(undefined),
  deleteFromS3: vi.fn().mockResolvedValue(undefined),
  downloadFromS3: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  mimeFromExt: (ext: string) => ext === '.png' ? 'image/png' : 'image/jpeg',
  isS3Configured: () => true,
}));

import app from '../app.js';
import { createTestUser, authHeaders, type TestUser } from './helpers.js';
import { db } from '../db/index.js';
import { listings, projects, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

function uniqueSuffix() {
  return crypto.randomUUID().slice(0, 8);
}

async function seedListing(userId: string, overrides: Record<string, any> = {}) {
  const suffix = uniqueSuffix();
  await db.insert(listings).values({
    externalId: `test-${suffix}`,
    platform: 'craigslist',
    url: `https://craigslist.org/${suffix}`,
    title: `Test Listing ${suffix}`,
    askingPrice: 100,
    fingerprint: `fp-${suffix}`,
    userId,
    ...overrides,
  });
  const [row] = await db.select().from(listings).where(eq(listings.externalId, `test-${suffix}`));
  return row!;
}

async function seedAnalyzedListing(userId: string) {
  return await seedListing(userId, {
    status: 'analyzed',
    furnitureType: 'dresser',
    furnitureStyle: 'mid-century modern',
    conditionScore: 7,
    conditionNotes: 'Minor scratches',
    woodSpecies: 'walnut',
    woodConfidence: 0.8,
  });
}

// ============================================================
// Auth
// ============================================================

describe('Auth', () => {
  it('rejects unauthenticated requests to protected routes', async () => {
    const routes = ['/api/listings', '/api/stats', '/api/admin/users'];
    for (const route of routes) {
      const res = await app.request(route);
      expect(res.status, `${route} should require auth`).toBe(401);
    }
  });

  it('signup + signin flow produces a usable session', async () => {
    const email = `auth-${uniqueSuffix()}@example.com`;
    const password = 'TestPassword123!';

    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Auth Test' }),
    });
    expect(signUpRes.status).toBe(200);

    const signInRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(signInRes.status).toBe(200);

    const setCookie = signInRes.headers.get('set-cookie') || '';
    const sessionCookie = setCookie.split(';').find(p => p.trim().startsWith('better-auth.session_token='))?.trim() || '';
    expect(sessionCookie).toBeTruthy();

    // Session cookie grants access to protected routes
    const res = await app.request('/api/listings', { headers: { Cookie: sessionCookie } });
    expect(res.status).toBe(200);
  });

  it('rejects duplicate email signup', async () => {
    const email = `dup-${uniqueSuffix()}@example.com`;
    const body = { email, password: 'TestPassword123!', name: 'Test' };

    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects wrong password', async () => {
    const email = `wrongpw-${uniqueSuffix()}@example.com`;

    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'CorrectPass123!', name: 'Test' }),
    });

    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'WrongPass123!' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('new users get role=user by default', async () => {
    const user = await createTestUser('user');
    const dbUser = await db.select().from(users).where(eq(users.id, user.id)).then(r => r[0])!;
    expect(dbUser.role).toBe('user');
  });
});

// ============================================================
// Sawbuck Listing Ownership & Visibility
// ============================================================

describe('Sawbuck listing visibility', () => {
  let owner: TestUser;
  let viewer: TestUser;
  let listingId: number;

  beforeAll(async () => {
    owner = await createTestUser('user');
    viewer = await createTestUser('user');

    // Seed a sawbuck listing directly in DB (avoids multipart complexity)
    const listing = await seedListing(owner.id, { platform: 'sawbuck', url: '', title: 'Sawbuck Oak Table' });
    listingId = listing.id;
  });

  it('owner can view their sawbuck listing', async () => {
    const res = await app.request(`/api/listings/${listingId}`, { headers: authHeaders(owner) });
    expect(res.status).toBe(200);
  });

  it('other users can view sawbuck listings', async () => {
    const res = await app.request(`/api/listings/${listingId}`, { headers: authHeaders(viewer) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Sawbuck Oak Table');
  });

  it('sawbuck listings appear in other users feeds', async () => {
    const res = await app.request('/api/listings?platform=sawbuck&limit=100', { headers: authHeaders(viewer) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listings.some((l: any) => l.id === listingId)).toBe(true);
  });

  it('non-owners cannot modify sawbuck listings', async () => {
    const res = await app.request(`/api/listings/${listingId}`, {
      method: 'PATCH',
      headers: { ...authHeaders(viewer), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'dismissed' }),
    });
    expect(res.status).toBe(404);
  });

  it('non-owners cannot delete sawbuck listings', async () => {
    const res = await app.request(`/api/listings/${listingId}`, {
      method: 'DELETE',
      headers: authHeaders(viewer),
    });
    expect(res.status).toBe(404);
  });

  it('owner can update listing status', async () => {
    const res = await app.request(`/api/listings/${listingId}`, {
      method: 'PATCH',
      headers: { ...authHeaders(owner), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'watching' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('watching');
  });

  it('owner can delete their listing', async () => {
    const toDelete = await seedListing(owner.id, { platform: 'sawbuck', url: '' });

    const res = await app.request(`/api/listings/${toDelete.id}`, {
      method: 'DELETE',
      headers: authHeaders(owner),
    });
    expect(res.status).toBe(200);

    const check = await db.select().from(listings).where(eq(listings.id, toDelete.id)).then(r => r[0]);
    expect(check).toBeUndefined();
  });

  it('scraped listings from other users are not visible', async () => {
    const otherUser = await createTestUser('user');
    await seedListing(otherUser.id, { title: 'Hidden Scraped Listing' });

    const res = await app.request('/api/listings?limit=500', { headers: authHeaders(owner) });
    const body = await res.json();
    expect(body.listings.some((l: any) => l.title === 'Hidden Scraped Listing')).toBe(false);
  });
});

// ============================================================
// Sawbuck Listing Creation (multipart)
// ============================================================

describe('Sawbuck listing creation', () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser('user');
  });

  it('rejects listing without photos', async () => {
    const res = await app.request('/api/listings/create', {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'multipart/form-data; boundary=---boundary' },
      body: [
        '-----boundary',
        'Content-Disposition: form-data; name="title"',
        '',
        'No Photo Listing',
        '-----boundary',
        'Content-Disposition: form-data; name="askingPrice"',
        '',
        '50',
        '-----boundary--',
      ].join('\r\n'),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.toLowerCase()).toContain('photo');
  });

  it('rejects listing without title', async () => {
    const res = await app.request('/api/listings/create', {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'multipart/form-data; boundary=---boundary' },
      body: [
        '-----boundary',
        'Content-Disposition: form-data; name="askingPrice"',
        '',
        '50',
        '-----boundary',
        'Content-Disposition: form-data; name="photos"; filename="test.jpg"',
        'Content-Type: image/jpeg',
        '',
        'fake-image-data',
        '-----boundary--',
      ].join('\r\n'),
    });
    expect(res.status).toBe(400);
  });

  it('creates listing with valid data and photo', async () => {
    // Build a FormData with a real JPEG (minimal valid JPEG: SOI + EOI markers)
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
    const formData = new FormData();
    formData.append('title', 'Integration Test Dresser');
    formData.append('askingPrice', '250');
    formData.append('photos', new Blob([jpegBytes], { type: 'image/jpeg' }), 'test.jpg');

    const res = await app.request('/api/listings/create', {
      method: 'POST',
      headers: authHeaders(user),
      body: formData,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.listing.platform).toBe('sawbuck');
    expect(body.listing.title).toBe('Integration Test Dresser');
    expect(body.listing.askingPrice).toBe(250);
    expect(body.listing.userId).toBe(user.id);
  });
});

// ============================================================
// Project Lifecycle
// ============================================================

describe('Project lifecycle', () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser('user');
  });

  it('creates a project from an analyzed listing', async () => {
    const listing = await seedAnalyzedListing(user.id);

    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listingId: listing.id,
        name: 'Test Flip',
        purchasePrice: 200,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Test Flip');
    expect(body.status).toBe('acquired');
    expect(body.purchasePrice).toBe(200);

    // Listing status should update to acquired
    const dbListing = await db.select().from(listings).where(eq(listings.id, listing.id)).then(r => r[0])!;
    expect(dbListing.status).toBe('acquired');
  });

  it('retrieves project with listing data', async () => {
    const listing = await seedAnalyzedListing(user.id);
    const createRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId: listing.id, name: 'Retrieve Test', purchasePrice: 100 }),
    });
    const project = await createRes.json();

    const res = await app.request(`/api/projects/${project.id}`, { headers: authHeaders(user) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listing).toBeDefined();
    expect(body.listing.id).toBe(listing.id);
  });

  it('updates project status and financials', async () => {
    const listing = await seedAnalyzedListing(user.id);
    const createRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId: listing.id, name: 'Status Test', purchasePrice: 150 }),
    });
    const project = await createRes.json();

    // Update status
    const statusRes = await app.request(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'refinishing' }),
    });
    expect(statusRes.status).toBe(200);
    expect((await statusRes.json()).status).toBe('refinishing');

    // Update financials
    const costsRes = await app.request(`/api/projects/${project.id}/costs`, {
      method: 'PATCH',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ hoursInvested: 8, soldPrice: 600, sellingFees: 30 }),
    });
    expect(costsRes.status).toBe(200);
    const costs = await costsRes.json();
    expect(costs.hoursInvested).toBe(8);
    expect(costs.soldPrice).toBe(600);
  });

  it('blocks refinishing plan for unanalyzed listing', async () => {
    const listing = await seedListing(user.id); // no furnitureType

    const createRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId: listing.id, name: 'Unanalyzed', purchasePrice: 50 }),
    });
    const project = await createRes.json();

    const planRes = await app.request(`/api/projects/${project.id}/refinish`, {
      method: 'POST',
      headers: authHeaders(user),
    });
    expect(planRes.status).toBe(422);
    const body = await planRes.json();
    expect(body.error.toLowerCase()).toContain('analyze');
  });

  it('project appears in pipeline', async () => {
    const listing = await seedAnalyzedListing(user.id);
    const createRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId: listing.id, name: 'Pipeline Test', purchasePrice: 100 }),
    });
    const project = await createRes.json();

    const res = await app.request('/api/projects/pipeline/all', { headers: authHeaders(user) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.some((p: any) => p.id === project.id)).toBe(true);
  });

  it('other users cannot access the project', async () => {
    const listing = await seedAnalyzedListing(user.id);
    const createRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId: listing.id, name: 'Isolation Test', purchasePrice: 100 }),
    });
    const project = await createRes.json();

    const otherUser = await createTestUser('user');
    const res = await app.request(`/api/projects/${project.id}`, { headers: authHeaders(otherUser) });
    expect(res.status).toBe(404);
  });

  it('deleting project reverts listing to analyzed status', async () => {
    const listing = await seedAnalyzedListing(user.id);
    const createRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId: listing.id, name: 'Delete Test', purchasePrice: 100 }),
    });
    const project = await createRes.json();

    const res = await app.request(`/api/projects/${project.id}`, {
      method: 'DELETE',
      headers: authHeaders(user),
    });
    expect(res.status).toBe(200);

    // Listing should revert to 'analyzed' since it has furnitureType
    const dbListing = await db.select().from(listings).where(eq(listings.id, listing.id)).then(r => r[0])!;
    expect(dbListing.status).toBe('analyzed');
  });
});

// ============================================================
// Admin Operations
// ============================================================

describe('Admin operations', () => {
  let admin: TestUser;
  let regularUser: TestUser;

  beforeAll(async () => {
    admin = await createTestUser('admin');
    regularUser = await createTestUser('user');
  });

  it('rejects non-admin from admin routes', async () => {
    const res = await app.request('/api/admin/users', { headers: authHeaders(regularUser) });
    expect(res.status).toBe(403);
  });

  it('lists all users with stats', async () => {
    const res = await app.request('/api/admin/users', { headers: authHeaders(admin) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);

    const adminEntry = body.find((u: any) => u.id === admin.id);
    expect(adminEntry).toBeDefined();
    expect(adminEntry.role).toBe('admin');
    expect(adminEntry).toHaveProperty('projectCount');
  });

  it('promotes and demotes a user', async () => {
    const target = await createTestUser('user');

    // Promote
    const promoteRes = await app.request(`/api/admin/users/${target.id}/role`, {
      method: 'PATCH',
      headers: { ...authHeaders(admin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(promoteRes.status).toBe(200);
    let dbUser = await db.select().from(users).where(eq(users.id, target.id)).then(r => r[0])!;
    expect(dbUser.role).toBe('admin');

    // Demote
    const demoteRes = await app.request(`/api/admin/users/${target.id}/role`, {
      method: 'PATCH',
      headers: { ...authHeaders(admin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    });
    expect(demoteRes.status).toBe(200);
    dbUser = await db.select().from(users).where(eq(users.id, target.id)).then(r => r[0])!;
    expect(dbUser.role).toBe('user');
  });

  it('prevents admin from demoting themselves', async () => {
    const res = await app.request(`/api/admin/users/${admin.id}/role`, {
      method: 'PATCH',
      headers: { ...authHeaders(admin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    });
    expect(res.status).toBe(400);
  });

  it('prevents admin from deleting themselves', async () => {
    const res = await app.request(`/api/admin/users/${admin.id}`, {
      method: 'DELETE',
      headers: authHeaders(admin),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid role', async () => {
    const target = await createTestUser('user');
    const res = await app.request(`/api/admin/users/${target.id}/role`, {
      method: 'PATCH',
      headers: { ...authHeaders(admin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'superadmin' }),
    });
    expect(res.status).toBe(400);
  });

  it('deletes user and cascades all data', async () => {
    const victim = await createTestUser('user');
    const listing = await seedListing(victim.id);

    const res = await app.request(`/api/admin/users/${victim.id}`, {
      method: 'DELETE',
      headers: authHeaders(admin),
    });
    expect(res.status).toBe(200);

    expect(await db.select().from(users).where(eq(users.id, victim.id)).then(r => r[0])).toBeUndefined();
    expect(await db.select().from(listings).where(eq(listings.userId, victim.id))).toHaveLength(0);
  });

  it('returns 404 when deleting nonexistent user', async () => {
    const res = await app.request('/api/admin/users/nonexistent-id', {
      method: 'DELETE',
      headers: authHeaders(admin),
    });
    expect(res.status).toBe(404);
  });
});
