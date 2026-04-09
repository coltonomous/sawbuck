import { describe, it, expect, beforeAll } from 'vitest';
import app from '../app.js';
import { createTestUser, authHeaders, type TestUser } from './helpers.js';
import { db } from '../db/index.js';
import { listings, projects, refinishingPlans, users } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

// ============================================================
// Auth Integration Tests
// ============================================================

describe('Auth', () => {
  it('rejects unauthenticated requests to protected routes', async () => {
    const routes = ['/api/listings', '/api/stats', '/api/usage/claude', '/api/admin/users'];
    for (const route of routes) {
      const res = await app.request(route);
      expect(res.status).toBe(401);
    }
  });

  it('creates a user via email signup and signs in', async () => {
    const email = `integration-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const password = 'TestPassword123!';

    // Sign up
    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Integration Test' }),
    });
    expect(signUpRes.status).toBe(200);

    // Sign in
    const signInRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(signInRes.status).toBe(200);

    // Extract session cookie and use it
    const setCookie = signInRes.headers.get('set-cookie') || '';
    const sessionCookie = setCookie.split(';').find(p => p.trim().startsWith('better-auth.session_token='))?.trim() || '';
    expect(sessionCookie).toBeTruthy();

    const listingsRes = await app.request('/api/listings', {
      headers: { Cookie: sessionCookie },
    });
    expect(listingsRes.status).toBe(200);
  });

  it('rejects signup with duplicate email', async () => {
    const email = `dup-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const password = 'TestPassword123!';

    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'First' }),
    });

    const dupRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Second' }),
    });
    // better-auth returns 422 for duplicate email
    expect(dupRes.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects signin with wrong password', async () => {
    const email = `wrongpw-${crypto.randomUUID().slice(0, 8)}@example.com`;

    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'CorrectPassword1!', name: 'Test' }),
    });

    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'WrongPassword1!' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('new users default to role=user with dailyClaudeLimit=20', async () => {
    const user = await createTestUser('user');
    const dbUser = db.select().from(users).where(eq(users.id, user.id)).get();
    expect(dbUser?.role).toBe('user');
    expect(dbUser?.dailyClaudeLimit).toBe(20);
  });
});

// ============================================================
// Sawbuck Listing Lifecycle
// ============================================================

describe('Sawbuck listing lifecycle', () => {
  let user: TestUser;
  let otherUser: TestUser;
  let listingId: number;

  beforeAll(async () => {
    user = await createTestUser('user');
    otherUser = await createTestUser('user');
  });

  it('creates a sawbuck listing', async () => {
    const res = await app.request('/api/listings/create', {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'multipart/form-data; boundary=---boundary' },
      body: [
        '-----boundary',
        'Content-Disposition: form-data; name="title"',
        '',
        'Test Oak Dresser',
        '-----boundary',
        'Content-Disposition: form-data; name="askingPrice"',
        '',
        '150',
        '-----boundary',
        'Content-Disposition: form-data; name="description"',
        '',
        'Solid oak dresser in good condition',
        '-----boundary',
        'Content-Disposition: form-data; name="location"',
        '',
        'Seattle',
        '-----boundary',
        'Content-Disposition: form-data; name="photos"; filename="test.jpg"',
        'Content-Type: image/jpeg',
        '',
        'fake-image-data',
        '-----boundary--',
      ].join('\r\n'),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.listing.platform).toBe('sawbuck');
    expect(body.listing.title).toBe('Test Oak Dresser');
    expect(body.listing.askingPrice).toBe(150);
    expect(body.listing.userId).toBe(user.id);
    listingId = body.listing.id;
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
    expect(body.error).toContain('photo');
  });

  it('other users can see sawbuck listings', async () => {
    const res = await app.request(`/api/listings/${listingId}`, {
      headers: authHeaders(otherUser),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Test Oak Dresser');
  });

  it('sawbuck listings appear in other users listing feeds', async () => {
    const res = await app.request('/api/listings?platform=sawbuck', {
      headers: authHeaders(otherUser),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listings.some((l: any) => l.id === listingId)).toBe(true);
  });

  it('other users cannot modify sawbuck listings they do not own', async () => {
    const res = await app.request(`/api/listings/${listingId}`, {
      method: 'PATCH',
      headers: { ...authHeaders(otherUser), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'dismissed' }),
    });
    expect(res.status).toBe(404);
  });

  it('other users cannot delete sawbuck listings they do not own', async () => {
    const res = await app.request(`/api/listings/${listingId}`, {
      method: 'DELETE',
      headers: authHeaders(otherUser),
    });
    expect(res.status).toBe(404);
  });

  it('owner can update listing status', async () => {
    const res = await app.request(`/api/listings/${listingId}`, {
      method: 'PATCH',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'watching' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('watching');
  });

  it('owner can delete their listing', async () => {
    // Create a separate listing to delete
    const suffix = crypto.randomUUID().slice(0, 6);
    db.insert(listings).values({
      externalId: `del-${suffix}`,
      platform: 'sawbuck',
      url: '',
      title: 'To Delete',
      askingPrice: 10,
      userId: user.id,
    }).run();
    const created = db.select().from(listings).where(eq(listings.externalId, `del-${suffix}`)).get()!;

    const res = await app.request(`/api/listings/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders(user),
    });
    expect(res.status).toBe(200);

    const check = db.select().from(listings).where(eq(listings.id, created.id)).get();
    expect(check).toBeUndefined();
  });
});

// ============================================================
// Project Lifecycle
// ============================================================

describe('Project lifecycle', () => {
  let user: TestUser;
  let listingId: number;
  let projectId: number;

  beforeAll(async () => {
    user = await createTestUser('user');

    // Seed a listing with analysis data (simulating post-Claude analysis)
    const suffix = crypto.randomUUID().slice(0, 6);
    db.insert(listings).values({
      externalId: `proj-${suffix}`,
      platform: 'craigslist',
      url: `https://craigslist.org/proj-${suffix}`,
      title: 'Mid-Century Walnut Dresser',
      askingPrice: 200,
      status: 'analyzed',
      furnitureType: 'dresser',
      furnitureStyle: 'mid-century modern',
      conditionScore: 7,
      conditionNotes: 'Minor surface scratches, all drawers functional',
      woodSpecies: 'walnut',
      woodConfidence: 0.8,
      fingerprint: `fp-proj-${suffix}`,
      userId: user.id,
    }).run();
    const listing = db.select().from(listings).where(eq(listings.externalId, `proj-${suffix}`)).get()!;
    listingId = listing.id;
  });

  it('creates a project from a listing', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listingId,
        name: 'Walnut Dresser Flip',
        purchasePrice: 200,
        purchaseDate: '2026-04-09',
        purchaseNotes: 'Picked up from Craigslist',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Walnut Dresser Flip');
    expect(body.status).toBe('acquired');
    expect(body.purchasePrice).toBe(200);
    projectId = body.id;
  });

  it('listing status updates to acquired', async () => {
    const listing = db.select().from(listings).where(eq(listings.id, listingId)).get()!;
    expect(listing.status).toBe('acquired');
  });

  it('retrieves project with listing data', async () => {
    const res = await app.request(`/api/projects/${projectId}`, {
      headers: authHeaders(user),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Walnut Dresser Flip');
    expect(body.listing).toBeDefined();
    expect(body.listing.title).toBe('Mid-Century Walnut Dresser');
  });

  it('updates project status', async () => {
    const res = await app.request(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'refinishing' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('refinishing');
  });

  it('updates project financials', async () => {
    const res = await app.request(`/api/projects/${projectId}/costs`, {
      method: 'PATCH',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hoursInvested: 8,
        hourlyRate: 25,
        soldPrice: 600,
        soldDate: '2026-05-01',
        sellingFees: 30,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hoursInvested).toBe(8);
    expect(body.soldPrice).toBe(600);
  });

  it('blocks refinishing plan without analysis', async () => {
    // Create an unanalyzed listing + project
    const suffix = crypto.randomUUID().slice(0, 6);
    db.insert(listings).values({
      externalId: `unanalyzed-${suffix}`,
      platform: 'craigslist',
      url: `https://craigslist.org/unanalyzed-${suffix}`,
      title: 'Unanalyzed Chair',
      askingPrice: 50,
      status: 'new',
      fingerprint: `fp-unanalyzed-${suffix}`,
      userId: user.id,
    }).run();
    const unanalyzedListing = db.select().from(listings).where(eq(listings.externalId, `unanalyzed-${suffix}`)).get()!;

    const projectRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listingId: unanalyzedListing.id,
        name: 'Unanalyzed Project',
        purchasePrice: 50,
      }),
    });
    expect(projectRes.status).toBe(201);
    const project = await projectRes.json();

    const planRes = await app.request(`/api/projects/${project.id}/refinish`, {
      method: 'POST',
      headers: authHeaders(user),
    });
    expect(planRes.status).toBe(422);
    const planBody = await planRes.json();
    expect(planBody.error).toContain('Analyze');
  });

  it('project appears in pipeline', async () => {
    const res = await app.request('/api/projects/pipeline/all', {
      headers: authHeaders(user),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.some((p: any) => p.id === projectId)).toBe(true);
  });

  it('other users cannot see the project', async () => {
    const otherUser = await createTestUser('user');
    const res = await app.request(`/api/projects/${projectId}`, {
      headers: authHeaders(otherUser),
    });
    expect(res.status).toBe(404);
  });

  it('deletes project and listing reverts', async () => {
    const res = await app.request(`/api/projects/${projectId}`, {
      method: 'DELETE',
      headers: authHeaders(user),
    });
    expect(res.status).toBe(200);

    const listing = db.select().from(listings).where(eq(listings.id, listingId)).get()!;
    expect(listing.status).not.toBe('acquired');
  });
});

// ============================================================
// Admin Operations
// ============================================================

describe('Admin operations', () => {
  let admin: TestUser;
  let regularUser: TestUser;
  let targetUser: TestUser;

  beforeAll(async () => {
    admin = await createTestUser('admin');
    regularUser = await createTestUser('user');
    targetUser = await createTestUser('user');
  });

  it('rejects non-admin from accessing admin routes', async () => {
    const res = await app.request('/api/admin/users', {
      headers: authHeaders(regularUser),
    });
    expect(res.status).toBe(403);
  });

  it('admin can list all users', async () => {
    const res = await app.request('/api/admin/users', {
      headers: authHeaders(admin),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(3);
    expect(body[0]).toHaveProperty('email');
    expect(body[0]).toHaveProperty('role');
    expect(body[0]).toHaveProperty('usageToday');
    expect(body[0]).toHaveProperty('listingCount');
  });

  it('admin can promote user to admin', async () => {
    const res = await app.request(`/api/admin/users/${targetUser.id}/role`, {
      method: 'PATCH',
      headers: { ...authHeaders(admin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(200);

    const dbUser = db.select().from(users).where(eq(users.id, targetUser.id)).get()!;
    expect(dbUser.role).toBe('admin');
    expect(dbUser.dailyClaudeLimit).toBe(999999);
  });

  it('admin can demote user back to user', async () => {
    const res = await app.request(`/api/admin/users/${targetUser.id}/role`, {
      method: 'PATCH',
      headers: { ...authHeaders(admin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    });
    expect(res.status).toBe(200);

    const dbUser = db.select().from(users).where(eq(users.id, targetUser.id)).get()!;
    expect(dbUser.role).toBe('user');
    expect(dbUser.dailyClaudeLimit).toBe(20);
  });

  it('admin cannot demote themselves', async () => {
    const res = await app.request(`/api/admin/users/${admin.id}/role`, {
      method: 'PATCH',
      headers: { ...authHeaders(admin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Cannot demote yourself');
  });

  it('admin cannot delete themselves', async () => {
    const res = await app.request(`/api/admin/users/${admin.id}`, {
      method: 'DELETE',
      headers: authHeaders(admin),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Cannot delete yourself');
  });

  it('rejects invalid role values', async () => {
    const res = await app.request(`/api/admin/users/${targetUser.id}/role`, {
      method: 'PATCH',
      headers: { ...authHeaders(admin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'superadmin' }),
    });
    expect(res.status).toBe(400);
  });

  it('admin can update user Claude limit', async () => {
    const res = await app.request(`/api/admin/users/${targetUser.id}/limit`, {
      method: 'PATCH',
      headers: { ...authHeaders(admin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 50 }),
    });
    expect(res.status).toBe(200);

    const dbUser = db.select().from(users).where(eq(users.id, targetUser.id)).get()!;
    expect(dbUser.dailyClaudeLimit).toBe(50);
  });

  it('admin can delete a user and all their data', async () => {
    const victim = await createTestUser('user');

    // Give the user some data
    const suffix = crypto.randomUUID().slice(0, 6);
    db.insert(listings).values({
      externalId: `victim-${suffix}`,
      platform: 'craigslist',
      url: `https://craigslist.org/victim-${suffix}`,
      title: 'Victim Listing',
      askingPrice: 100,
      fingerprint: `fp-victim-${suffix}`,
      userId: victim.id,
    }).run();

    const res = await app.request(`/api/admin/users/${victim.id}`, {
      method: 'DELETE',
      headers: authHeaders(admin),
    });
    expect(res.status).toBe(200);

    // Verify user and their data are gone
    const dbUser = db.select().from(users).where(eq(users.id, victim.id)).get();
    expect(dbUser).toBeUndefined();

    const dbListings = db.select().from(listings).where(eq(listings.userId, victim.id)).all();
    expect(dbListings).toHaveLength(0);
  });
});
