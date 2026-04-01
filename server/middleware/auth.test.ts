import { describe, it, expect, beforeAll } from 'vitest';
import app from '../app.js';
import { createTestUser, authHeaders, type TestUser } from '../test/helpers.js';

let regularUser: TestUser;
let adminUser: TestUser;

beforeAll(async () => {
  regularUser = await createTestUser('user');
  adminUser = await createTestUser('admin');
});

describe('requireAuth middleware', () => {
  it('rejects requests with no cookie', async () => {
    const res = await app.request('/api/listings');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects requests with invalid session token', async () => {
    const res = await app.request('/api/listings', {
      headers: { Cookie: 'better-auth.session_token=invalid-token-123' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts requests with valid session', async () => {
    const res = await app.request('/api/listings?limit=1', {
      headers: authHeaders(regularUser),
    });
    expect(res.status).toBe(200);
  });

  it('does not require auth for /health', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });

  it('does not require auth for /api/auth routes', async () => {
    // better-auth's get-session endpoint should not 401
    const res = await app.request('/api/auth/get-session');
    // It may return 200 with null session or redirect, but not 401 from our middleware
    expect(res.status).not.toBe(401);
  });
});

describe('requireAdmin middleware', () => {
  it('allows admin to toggle platforms', async () => {
    const res = await app.request('/api/scrapers/platforms/craigslist', {
      method: 'PATCH',
      headers: { ...authHeaders(adminUser), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects non-admin from toggling platforms', async () => {
    const res = await app.request('/api/scrapers/platforms/craigslist', {
      method: 'PATCH',
      headers: { ...authHeaders(regularUser), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
  });
});
