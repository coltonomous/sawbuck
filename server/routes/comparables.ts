import { Hono } from 'hono';
import { db } from '../db/index.js';
import { comparables, listings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { searchEbayComps, type CompSearchParams } from '../scrapers/ebay-comps.js';
import { closeBrowser } from '../scrapers/browser-pool.js';
import { searchComparablesSchema } from '../lib/validation.js';

export const comparablesRouter = new Hono();

// POST /search — search for comparables
comparablesRouter.post('/search', async (c) => {
  const raw = await c.req.json();
  const parsed = searchComparablesSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const { listingId, query: explicitQuery } = parsed.data;
  let params: CompSearchParams | null = null;

  if (listingId) {
    const listing = await db.select().from(listings).where(eq(listings.id, listingId)).get();
    if (!listing) return c.json({ error: 'Listing not found' }, 404);

    params = {
      furnitureType: listing.furnitureType,
      furnitureStyle: listing.furnitureStyle,
      woodSpecies: listing.woodSpecies,
      title: listing.title,
    };
  }

  if (explicitQuery) {
    params = params ?? { title: null, furnitureType: null, furnitureStyle: null, woodSpecies: null };
    params.title = explicitQuery;
  }

  if (!params || (!params.furnitureType && !params.furnitureStyle && !params.title)) {
    return c.json({ error: 'query or listingId with analysis data is required' }, 400);
  }

  try {
    const { comps, blocked } = await searchEbayComps(params, listingId);
    await closeBrowser();
    return c.json({ comps, blocked });
  } catch (err: unknown) {
    await closeBrowser();
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

// GET /:listingId — get stored comparables for a listing
comparablesRouter.get('/:listingId', async (c) => {
  const listingId = parseInt(c.req.param('listingId'));
  const results = await db.select()
    .from(comparables)
    .where(eq(comparables.listingId, listingId));

  return c.json(results);
});
