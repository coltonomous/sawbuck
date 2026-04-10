import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../db/index.js';
import { users, listings } from '../../db/schema.js';
import { eq, and, isNull, lte, gte, or, sql } from 'drizzle-orm';
import crypto from 'crypto';

// Test preference filtering logic in isolation (same SQL patterns as listings route)
// We test the SQL conditions directly against the DB rather than going through HTTP

const TEST_USER_ID = `pref-test-${crypto.randomUUID()}`;
const AGENT_LISTING_PREFIX = `pref-agent-${Date.now()}`;
const USER_LISTING_PREFIX = `pref-user-${Date.now()}`;

let agentListingIds: number[] = [];
let userListingIds: number[] = [];

beforeAll(async () => {
  // Create test user with preferences
  await db.insert(users).values({
    id: TEST_USER_ID,
    name: 'Pref Test User',
    email: `preftest-${crypto.randomUUID()}@test.com`,
    emailVerified: false,
    role: 'user',
    preferredLatitude: 47.6062, // Seattle
    preferredLongitude: -122.3321,
    preferredRadiusMiles: 25,
    maxBudget: 200,
    shopSpace: 'small_workshop',
    experienceLevel: 'beginner',
    stylePreferences: JSON.stringify(['mid-century', 'farmhouse']),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Create agent listings (userId = null)
  const agentData = [
    { externalId: `${AGENT_LISTING_PREFIX}-cheap`, title: 'Cheap dresser', askingPrice: 50, furnitureType: 'dresser', conditionScore: 7, furnitureStyle: 'mid-century modern', latitude: 47.61, longitude: -122.33 },
    { externalId: `${AGENT_LISTING_PREFIX}-expensive`, title: 'Expensive table', askingPrice: 500, furnitureType: 'table', conditionScore: 8, furnitureStyle: 'mid-century', latitude: 47.61, longitude: -122.33 },
    { externalId: `${AGENT_LISTING_PREFIX}-far`, title: 'Far away chair', askingPrice: 100, furnitureType: 'chair', conditionScore: 7, furnitureStyle: 'farmhouse', latitude: 45.0, longitude: -122.0 }, // Portland area
    { externalId: `${AGENT_LISTING_PREFIX}-sofa`, title: 'Big sofa', askingPrice: 75, furnitureType: 'sofa', conditionScore: 7, furnitureStyle: 'modern', latitude: 47.61, longitude: -122.33 },
    { externalId: `${AGENT_LISTING_PREFIX}-damaged`, title: 'Heavily damaged desk', askingPrice: 30, furnitureType: 'desk', conditionScore: 2, furnitureStyle: 'mid-century', latitude: 47.61, longitude: -122.33 },
    { externalId: `${AGENT_LISTING_PREFIX}-victorian`, title: 'Victorian dresser', askingPrice: 100, furnitureType: 'dresser', conditionScore: 7, furnitureStyle: 'victorian', latitude: 47.61, longitude: -122.33 },
    { externalId: `${AGENT_LISTING_PREFIX}-noanalysis`, title: 'Unanalyzed item', askingPrice: 80, furnitureType: null, conditionScore: null, furnitureStyle: null, latitude: null, longitude: null },
  ];

  for (const data of agentData) {
    const result = await db.insert(listings).values({
      externalId: data.externalId,
      platform: 'craigslist',
      url: `https://test.craigslist.org/${data.externalId}.html`,
      title: data.title,
      askingPrice: data.askingPrice,
      furnitureType: data.furnitureType,
      conditionScore: data.conditionScore,
      furnitureStyle: data.furnitureStyle,
      latitude: data.latitude,
      longitude: data.longitude,
      userId: null, // agent listing
      triageSource: 'agent_sonnet',
    }).returning({ id: listings.id });
    agentListingIds.push(result[0].id);
  }

  // Create a user-owned listing that would fail all filters
  const userResult = await db.insert(listings).values({
    externalId: `${USER_LISTING_PREFIX}-user-expensive`,
    platform: 'craigslist',
    url: `https://test.craigslist.org/${USER_LISTING_PREFIX}-user.html`,
    title: 'User expensive sofa in bad shape',
    askingPrice: 999,
    furnitureType: 'sofa',
    conditionScore: 1,
    furnitureStyle: 'victorian',
    latitude: 45.0,
    longitude: -122.0,
    userId: TEST_USER_ID,
  }).returning({ id: listings.id });
  userListingIds.push(userResult[0].id);
});

afterAll(async () => {
  // Cleanup
  for (const id of [...agentListingIds, ...userListingIds]) {
    await db.delete(listings).where(eq(listings.id, id));
  }
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
});

// Helper: query agent listings visible to the test user with given filters
async function queryAgentListings(
  filters: {
    maxBudget?: number;
    lat?: number; lng?: number; radius?: number;
    shopSpace?: string;
    experienceLevel?: string;
    styles?: string[];
  } = {},
) {
  const conditions = [
    // Only our test listings
    sql`${listings.externalId} LIKE ${AGENT_LISTING_PREFIX + '%'}`,
    // Agent listings only
    isNull(listings.userId),
  ];

  if (filters.maxBudget) {
    conditions.push(
      or(
        lte(listings.askingPrice, filters.maxBudget),
        isNull(listings.askingPrice),
      )!,
    );
  }

  if (filters.lat && filters.lng && filters.radius) {
    conditions.push(
      or(
        isNull(listings.latitude),
        sql`(3959 * acos(cos(radians(${filters.lat})) * cos(radians(${listings.latitude})) * cos(radians(${listings.longitude}) - radians(${filters.lng})) + sin(radians(${filters.lat})) * sin(radians(${listings.latitude})))) <= ${filters.radius}`,
      )!,
    );
  }

  if (filters.shopSpace === 'small_workshop') {
    conditions.push(
      or(
        sql`${listings.furnitureType} NOT IN ('sofa', 'sectional', 'dining_table', 'bed_frame')`,
        isNull(listings.furnitureType),
      )!,
    );
  }

  if (filters.experienceLevel === 'beginner') {
    conditions.push(
      or(
        gte(listings.conditionScore, 5),
        isNull(listings.conditionScore),
      )!,
    );
  }

  if (filters.styles && filters.styles.length > 0) {
    const styleConditions = filters.styles.map((s) => sql`${listings.furnitureStyle} LIKE ${'%' + s + '%'}`);
    conditions.push(
      or(
        isNull(listings.furnitureStyle),
        or(...styleConditions)!,
      )!,
    );
  }

  return db.select({ id: listings.id, title: listings.title, externalId: listings.externalId })
    .from(listings)
    .where(and(...conditions))
    ;
}

describe('User Preference Filtering', () => {
  it('budget filter excludes expensive agent listings', async () => {
    const results = await queryAgentListings({ maxBudget: 200 });
    const titles = results.map((r) => r.title);
    expect(titles).toContain('Cheap dresser');
    expect(titles).not.toContain('Expensive table');
  });

  it('radius filter excludes distant listings', async () => {
    const results = await queryAgentListings({ lat: 47.6062, lng: -122.3321, radius: 25 });
    const titles = results.map((r) => r.title);
    expect(titles).toContain('Cheap dresser');
    expect(titles).not.toContain('Far away chair');
  });

  it('shop space filter excludes oversized items for small workshops', async () => {
    const results = await queryAgentListings({ shopSpace: 'small_workshop' });
    const titles = results.map((r) => r.title);
    expect(titles).toContain('Cheap dresser');
    expect(titles).not.toContain('Big sofa');
  });

  it('experience filter hides low-condition items from beginners', async () => {
    const results = await queryAgentListings({ experienceLevel: 'beginner' });
    const titles = results.map((r) => r.title);
    expect(titles).toContain('Cheap dresser');
    expect(titles).not.toContain('Heavily damaged desk');
  });

  it('style filter matches preferred styles', async () => {
    const results = await queryAgentListings({ styles: ['mid-century', 'farmhouse'] });
    const titles = results.map((r) => r.title);
    expect(titles).toContain('Cheap dresser'); // mid-century modern
    expect(titles).toContain('Far away chair'); // farmhouse
    expect(titles).not.toContain('Victorian dresser');
  });

  it('unanalyzed agent listings (null fields) are still shown', async () => {
    const results = await queryAgentListings({
      maxBudget: 200,
      lat: 47.6062, lng: -122.3321, radius: 25,
      shopSpace: 'small_workshop',
      experienceLevel: 'beginner',
      styles: ['mid-century'],
    });
    const titles = results.map((r) => r.title);
    expect(titles).toContain('Unanalyzed item');
  });

  it('multiple preferences compose correctly (AND)', async () => {
    const results = await queryAgentListings({
      maxBudget: 200,
      lat: 47.6062, lng: -122.3321, radius: 25,
      shopSpace: 'small_workshop',
      experienceLevel: 'beginner',
      styles: ['mid-century'],
    });
    const titles = results.map((r) => r.title);
    // Only cheap, nearby, small, good condition, mid-century items + unanalyzed
    expect(titles).toContain('Cheap dresser');
    expect(titles).toContain('Unanalyzed item');
    expect(titles).not.toContain('Expensive table');
    expect(titles).not.toContain('Far away chair');
    expect(titles).not.toContain('Big sofa');
    expect(titles).not.toContain('Heavily damaged desk');
    expect(titles).not.toContain('Victorian dresser');
  });

  it('null preferences mean no filtering for that dimension', async () => {
    // No filters = all agent listings shown
    const results = await queryAgentListings({});
    expect(results.length).toBe(7); // all agent listings
  });

  it('user own listings are never filtered by preferences', async () => {
    // Query including both user and agent listings
    const conditions = [
      or(
        sql`${listings.externalId} LIKE ${AGENT_LISTING_PREFIX + '%'}`,
        sql`${listings.externalId} LIKE ${USER_LISTING_PREFIX + '%'}`,
      )!,
      // Visibility: user's own OR agent
      or(
        eq(listings.userId, TEST_USER_ID),
        isNull(listings.userId),
      )!,
    ];

    // Apply budget filter only to agent listings
    conditions.push(
      or(
        sql`${listings.userId} IS NOT NULL`, // user's own: always show
        lte(listings.askingPrice, 200), // agent: filter by budget
        isNull(listings.askingPrice),
      )!,
    );

    const results = await db.select({ id: listings.id, title: listings.title, userId: listings.userId })
      .from(listings)
      .where(and(...conditions))
      ;

    const titles = results.map((r) => r.title);
    // User's $999 listing should still be shown
    expect(titles).toContain('User expensive sofa in bad shape');
    // But agent's $500 listing should be filtered
    expect(titles).not.toContain('Expensive table');
  });
});
