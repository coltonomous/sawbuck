/**
 * Smoke test: verify that platform scrapers can fetch and parse real listings.
 * Run with: npx tsx scripts/smoke-test-scraper.ts
 *
 * Does NOT require a database — skips dedup and just tests the HTTP + parse layer.
 */

import { clFetch, warmCookies } from '../server/integrations/craigslist/client.js';
import { offerUpFetch, warmCookies as warmOfferUpCookies } from '../server/integrations/offerup/client.js';

const REGION = {
  id: 0,
  name: 'seattle',
  latitude: 47.6062,
  longitude: -122.3321,
  radiusMiles: 30,
  clSubdomain: 'seattle',
};

async function testCraigslist() {
  console.log('\n=== Craigslist Smoke Test ===\n');

  try {
    await warmCookies(REGION.clSubdomain!);
    console.log('  Cookies warmed');

    const searchUrl = `https://${REGION.clSubdomain}.craigslist.org/search/fua#search=1~list~0~0`;
    console.log(`  Fetching: ${searchUrl}`);
    const res = await clFetch(searchUrl, { referer: `https://${REGION.clSubdomain}.craigslist.org/` });

    if (!res.ok) {
      console.error(`  FAIL: HTTP ${res.status} ${res.statusText}`);
      return false;
    }

    const html = await res.text();
    console.log(`  Response: ${html.length} bytes`);

    const ldMatch = html.match(/id="ld_searchpage_results"[^>]*>([\s\S]*?)<\/script>/);
    if (!ldMatch) {
      console.error('  FAIL: No JSON-LD found in search page');
      return false;
    }

    const data = JSON.parse(ldMatch[1]);
    const items = data.itemListElement ?? [];
    console.log(`  JSON-LD items: ${items.length}`);

    if (items.length === 0) {
      console.error('  FAIL: 0 items in JSON-LD');
      return false;
    }

    const first = items[0].item;
    console.log(`  First item: "${first.name}" - $${first.offers?.price ?? '?'}`);
    console.log(`  PASS: CL scraper working`);
    return true;
  } catch (err) {
    console.error(`  FAIL: ${err}`);
    return false;
  }
}

// US states that overlap with the target region's expected results.
// Used to sanity-check that OfferUp is returning local listings, not
// falling back to IP geolocation (which typically resolves to Kansas).
const KANSAS_LOCATIONS = ['KS', 'Kansas', 'Wichita', 'Topeka', 'Overland Park', 'Olathe'];

function looksLikeKansas(locationName: string): boolean {
  return KANSAS_LOCATIONS.some((kw) => locationName.includes(kw));
}

async function testOfferUp() {
  console.log('\n=== OfferUp Smoke Test ===\n');

  try {
    await warmOfferUpCookies(REGION);
    console.log('  Cookies warmed');

    const params = new URLSearchParams({
      q: 'wood furniture',
      lat: String(REGION.latitude),
      lng: String(REGION.longitude),
      radius: String(REGION.radiusMiles),
      delivery_param: 'all',
    });

    const searchUrl = `https://offerup.com/search?${params}`;
    console.log(`  Fetching: ${searchUrl}`);

    const res = await offerUpFetch(searchUrl);

    if (!res.ok) {
      console.error(`  FAIL: HTTP ${res.status} ${res.statusText}`);
      return false;
    }

    const html = await res.text();
    console.log(`  Response: ${html.length} bytes`);

    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!nextDataMatch) {
      console.error('  FAIL: No __NEXT_DATA__ found in search page');
      return false;
    }

    const nextData = JSON.parse(nextDataMatch[1]);
    const feed = nextData?.props?.pageProps?.searchFeedResponse ?? {};
    const tiles = (feed.looseTiles ?? feed.tightTiles ?? []) as Array<{ __typename: string; listing?: { listingId: string; title: string; price: number | null; locationName?: string } }>;
    const listings = tiles.filter((t) => t.__typename === 'ModularFeedTileListing');

    console.log(`  Total tiles: ${tiles.length}`);
    console.log(`  Listing tiles: ${listings.length}`);

    if (listings.length === 0) {
      console.error('  FAIL: 0 listing tiles');
      return false;
    }

    // Print all listing locations so the operator can eyeball them
    console.log(`  Listing locations:`);
    for (const tile of listings) {
      const l = tile.listing!;
      console.log(`    - "${l.title}" ($${l.price ?? '?'}) — ${l.locationName ?? 'unknown'}`);
    }

    // Check that results are NOT from Kansas (the IP-geolocation fallback)
    const kansasCount = listings.filter((t) => looksLikeKansas(t.listing?.locationName ?? '')).length;
    if (kansasCount > 0 && kansasCount === listings.length) {
      console.error(`  FAIL: All ${listings.length} listings are from Kansas — location filter is not working`);
      return false;
    }
    if (kansasCount > 0) {
      console.warn(`  WARN: ${kansasCount}/${listings.length} listings from Kansas — location filter may be partially broken`);
    }

    console.log(`  PASS: OfferUp scraper returned ${listings.length} listings from expected region`);
    return true;
  } catch (err) {
    console.error(`  FAIL: ${err}`);
    return false;
  }
}

async function main() {
  console.log('Sawbuck Scraper Smoke Test');
  console.log('=========================');

  const clOk = await testCraigslist();
  const ouOk = await testOfferUp();

  console.log('\n=== Results ===');
  console.log(`  Craigslist: ${clOk ? 'PASS' : 'FAIL'}`);
  console.log(`  OfferUp:    ${ouOk ? 'PASS' : 'FAIL'}`);

  if (!clOk || !ouOk) process.exit(1);
}

main();
