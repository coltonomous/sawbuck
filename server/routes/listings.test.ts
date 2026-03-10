import { describe, it, expect } from 'vitest';
import app from '../index.js';

describe('API routes', () => {
  describe('GET /health', () => {
    it('returns ok status', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: 'ok' });
    });
  });

  describe('GET /api/listings', () => {
    it('returns paginated listings', async () => {
      const res = await app.request('/api/listings?limit=10');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('listings');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.listings)).toBe(true);
    });

    it('accepts sort parameters', async () => {
      const res = await app.request('/api/listings?sort=askingPrice&sort_dir=asc&limit=5');
      expect(res.status).toBe(200);
    });

    it('accepts filter parameters', async () => {
      const res = await app.request('/api/listings?platform=craigslist&status=new&limit=5');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/listings/:id', () => {
    it('returns 404 for non-existent listing', async () => {
      const res = await app.request('/api/listings/999999');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    });
  });

  describe('API key auth', () => {
    it('allows requests when no API_KEY is configured', async () => {
      // API_KEY is not set in test env, so all requests should pass
      const res = await app.request('/api/listings?limit=1');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/scrapers/jobs/:id', () => {
    it('returns 404 for non-existent job', async () => {
      const res = await app.request('/api/scrapers/jobs/nonexistent-id');
      expect(res.status).toBe(404);
    });
  });
});
