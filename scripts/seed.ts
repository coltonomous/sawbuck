import { db } from '../server/db/index.js';
import { listings, listingImages, comparables, searchConfigs } from '../server/db/schema.js';

const now = new Date().toISOString();

// Sample listings that show the app's range: good deals, bad deals, analyzed, unanalyzed
const sampleListings = [
  {
    externalId: 'seed-001',
    platform: 'craigslist' as const,
    url: 'https://seattle.craigslist.org/see/fuo/d/mid-century-walnut-dresser/seed001.html',
    title: 'Mid Century Walnut Dresser — 9 drawers, original hardware',
    description: 'Solid walnut dresser from the 1960s. All drawers slide smoothly. Some surface scratches on top. Original brass pulls. Moving, needs to go this weekend.',
    askingPrice: 120,
    location: 'Capitol Hill, Seattle',
    latitude: 47.6253,
    longitude: -122.3222,
    status: 'analyzed' as const,
    furnitureType: 'dresser',
    furnitureStyle: 'mid-century modern',
    conditionScore: 7.5,
    conditionNotes: 'Surface scratches on top, minor edge wear. Drawers function well. Original brass hardware intact. Solid walnut construction, not veneer.',
    woodSpecies: 'walnut',
    woodConfidence: 0.85,
    estimatedValue: 350,
    estimatedRefinishedValue: 550,
    dealScore: 2.92,
    analyzedAt: now,
    fingerprint: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    matchedSearchTerms: JSON.stringify(['mid century dresser', 'walnut furniture']),
  },
  {
    externalId: 'seed-002',
    platform: 'offerup' as const,
    url: 'https://offerup.com/item/detail/seed002',
    title: 'Solid Oak Dining Table — seats 6',
    description: 'Heavy oak table, very solid. Has water rings and some scratches. Legs are sturdy. Could be beautiful with refinishing.',
    askingPrice: 75,
    location: 'Ballard, Seattle',
    latitude: 47.6677,
    longitude: -122.3846,
    status: 'analyzed' as const,
    furnitureType: 'table',
    furnitureStyle: 'traditional',
    conditionScore: 5,
    conditionNotes: 'Multiple water rings on surface, scratches throughout. Structurally sound — no wobble. Finish is shot but the wood underneath looks solid. Standard mission-style oak, likely early 2000s reproduction.',
    woodSpecies: 'oak',
    woodConfidence: 0.9,
    estimatedValue: 180,
    estimatedRefinishedValue: 400,
    dealScore: 2.4,
    analyzedAt: now,
    fingerprint: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
    matchedSearchTerms: JSON.stringify(['oak table']),
  },
  {
    externalId: 'seed-003',
    platform: 'mercari' as const,
    url: 'https://www.mercari.com/us/item/seed003/',
    title: 'IKEA Malm 6-Drawer Dresser White',
    description: 'White Malm dresser, good condition. Minor scuff on one corner. All drawers work fine.',
    askingPrice: 85,
    location: 'Fremont, Seattle',
    latitude: 47.6506,
    longitude: -122.3509,
    status: 'analyzed' as const,
    furnitureType: 'dresser',
    furnitureStyle: 'contemporary',
    conditionScore: 6,
    conditionNotes: 'Particle board with white laminate. Scuff on front left corner exposing raw MDF. Not worth refinishing — this is disposable furniture. Fair price for what it is, but zero flip potential.',
    woodSpecies: null,
    woodConfidence: 0.95,
    estimatedValue: 60,
    estimatedRefinishedValue: 60,
    dealScore: 0.71,
    analyzedAt: now,
    fingerprint: 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
    matchedSearchTerms: JSON.stringify(['dresser']),
  },
  {
    externalId: 'seed-004',
    platform: 'craigslist' as const,
    url: 'https://seattle.craigslist.org/tac/fuo/d/danish-modern-teak-credenza/seed004.html',
    title: 'Danish Modern Teak Credenza — 1960s',
    description: 'Beautiful teak credenza, 60" wide. Sliding doors, adjustable shelf inside. Some fading on top from sun exposure. Legs in great shape.',
    askingPrice: 200,
    location: 'Tacoma',
    latitude: 47.2529,
    longitude: -122.4443,
    status: 'analyzed' as const,
    furnitureType: 'sideboard',
    furnitureStyle: 'danish modern',
    conditionScore: 7,
    conditionNotes: 'Sun fading on top surface, otherwise excellent. Sliding doors operate smoothly. Interior shelf adjustable. Tapered legs solid, no wobble. Genuine teak — grain and color are consistent.',
    woodSpecies: 'teak',
    woodConfidence: 0.8,
    estimatedValue: 600,
    estimatedRefinishedValue: 900,
    dealScore: 3.0,
    analyzedAt: now,
    fingerprint: 'd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1',
    matchedSearchTerms: JSON.stringify(['teak credenza', 'mid century furniture']),
  },
  {
    externalId: 'seed-005',
    platform: 'craigslist' as const,
    url: 'https://seattle.craigslist.org/see/fuo/d/vintage-lane-cedar-chest/seed005.html',
    title: 'Vintage Lane Cedar Chest',
    description: 'Lane cedar chest, works perfectly. Has the original lock and key. Some scratches.',
    askingPrice: 150,
    location: 'Queen Anne, Seattle',
    latitude: 47.6372,
    longitude: -122.3571,
    status: 'analyzed' as const,
    furnitureType: 'cabinet',
    furnitureStyle: 'traditional',
    conditionScore: 6.5,
    conditionNotes: 'Surface scratches on lid and sides. Cedar interior still fragrant. Original lock mechanism works. Waterfall edge style, probably 1940s-50s. These are common and the market is saturated.',
    woodSpecies: 'cedar',
    woodConfidence: 0.95,
    estimatedValue: 120,
    estimatedRefinishedValue: 200,
    dealScore: 0.8,
    analyzedAt: now,
    fingerprint: 'e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    matchedSearchTerms: JSON.stringify(['cedar chest']),
  },
  {
    externalId: 'seed-006',
    platform: 'offerup' as const,
    url: 'https://offerup.com/item/detail/seed006',
    title: 'Maple Rocking Chair — needs TLC',
    description: 'Old maple rocker. Spindles are all intact. Needs new finish and maybe a new seat. Sturdy frame.',
    askingPrice: 30,
    location: 'Columbia City, Seattle',
    latitude: 47.5603,
    longitude: -122.2866,
    status: 'new' as const,
    fingerprint: 'f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
    matchedSearchTerms: JSON.stringify(['rocking chair']),
  },
  {
    externalId: 'seed-007',
    platform: 'mercari' as const,
    url: 'https://www.mercari.com/us/item/seed007/',
    title: 'Art Deco Vanity with Mirror — Tiger Oak',
    description: 'Gorgeous vanity with attached tri-fold mirror. Tiger oak with beautiful grain. All drawers open. Mirror has some foxing around edges. One drawer pull is loose.',
    askingPrice: 175,
    location: 'Bellevue',
    latitude: 47.6101,
    longitude: -122.2015,
    status: 'new' as const,
    fingerprint: 'a7b8c9d0e1f2a7b8c9d0e1f2a7b8c9d0',
    matchedSearchTerms: JSON.stringify(['vanity', 'oak furniture']),
  },
  {
    externalId: 'seed-008',
    platform: 'craigslist' as const,
    url: 'https://seattle.craigslist.org/see/fuo/d/mcm-nightstand-pair/seed008.html',
    title: 'MCM Nightstand Pair — walnut veneer',
    description: 'Pair of mid-century nightstands. Walnut veneer over plywood. Single drawer each. Tapered legs. One has a small chip on the edge. Selling as pair only.',
    askingPrice: 90,
    location: 'Greenwood, Seattle',
    latitude: 47.6932,
    longitude: -122.3554,
    status: 'analyzed' as const,
    furnitureType: 'nightstand',
    furnitureStyle: 'mid-century modern',
    conditionScore: 6,
    conditionNotes: 'Walnut veneer, not solid. Small chip on right nightstand front edge — veneer repair needed. Drawer slides are sticky. Legs solid. Decent pair but veneer limits refinishing options.',
    woodSpecies: 'walnut',
    woodConfidence: 0.7,
    estimatedValue: 150,
    estimatedRefinishedValue: 250,
    dealScore: 1.67,
    analyzedAt: now,
    fingerprint: 'b8c9d0e1f2a3b8c9d0e1f2a3b8c9d0e1',
    matchedSearchTerms: JSON.stringify(['mid century nightstand', 'walnut furniture']),
  },
];

const sampleComps = [
  // Comps for the walnut dresser (listing 1)
  { source: 'ebay_sold', title: 'Mid Century Walnut 9 Drawer Dresser Long MCM', soldPrice: 325, soldDate: '2025-12-15', furnitureType: 'dresser', furnitureStyle: 'mid-century modern', searchQuery: 'mid century walnut dresser' },
  { source: 'ebay_sold', title: 'Vintage MCM Walnut Dresser Credenza 9 Drawers', soldPrice: 400, soldDate: '2025-11-28', furnitureType: 'dresser', furnitureStyle: 'mid-century modern', searchQuery: 'mid century walnut dresser' },
  { source: 'ebay_sold', title: 'Mid-Century Modern Walnut Triple Dresser Original Hardware', soldPrice: 375, soldDate: '2026-01-05', furnitureType: 'dresser', furnitureStyle: 'mid-century modern', searchQuery: 'mid century walnut dresser' },
  { source: 'ebay_active', title: 'MCM Walnut 9-Drawer Dresser Brass Pulls', soldPrice: 450, furnitureType: 'dresser', furnitureStyle: 'mid-century modern', searchQuery: 'mid century walnut dresser' },
  // Comps for the teak credenza (listing 4)
  { source: 'ebay_sold', title: 'Danish Modern Teak Credenza Sideboard 60"', soldPrice: 575, soldDate: '2026-01-20', furnitureType: 'sideboard', furnitureStyle: 'danish modern', searchQuery: 'danish teak credenza' },
  { source: 'ebay_sold', title: 'Vintage Teak Credenza Denmark Sliding Doors', soldPrice: 650, soldDate: '2025-12-10', furnitureType: 'sideboard', furnitureStyle: 'danish modern', searchQuery: 'danish teak credenza' },
  { source: 'ebay_sold', title: '1960s Danish Teak Sideboard Credenza', soldPrice: 520, soldDate: '2026-02-01', furnitureType: 'sideboard', furnitureStyle: 'danish modern', searchQuery: 'danish teak credenza' },
];

const sampleSearchConfigs = [
  { platform: 'craigslist' as const, searchTerm: 'mid century dresser', location: 'seattle', isActive: true },
  { platform: 'craigslist' as const, searchTerm: 'walnut furniture', location: 'seattle', isActive: true },
  { platform: 'offerup' as const, searchTerm: 'oak table', location: 'seattle', isActive: true },
  { platform: 'mercari' as const, searchTerm: 'vintage vanity', isActive: true },
];

async function seed() {
  console.log('Seeding database...');

  // Insert search configs
  for (const config of sampleSearchConfigs) {
    await db.insert(searchConfigs).values(config).onConflictDoNothing();
  }
  console.log(`  ${sampleSearchConfigs.length} search configs`);

  // Insert listings
  const insertedListings: number[] = [];
  for (const listing of sampleListings) {
    const result = await db.insert(listings).values({
      ...listing,
      scrapedAt: now,
    }).onConflictDoNothing().returning({ id: listings.id });

    if (result.length > 0) {
      insertedListings.push(result[0].id);
    }
  }
  console.log(`  ${insertedListings.length} listings`);

  // Insert placeholder images (no actual files — just marks them as pending)
  for (const listingId of insertedListings) {
    await db.insert(listingImages).values({
      listingId,
      sourceUrl: `https://example.com/images/seed-${listingId}.jpg`,
      downloadStatus: 'pending',
    });
  }
  console.log(`  ${insertedListings.length} placeholder images`);

  // Insert comps for listings that have them
  if (insertedListings.length >= 4) {
    const dresserComps = sampleComps.slice(0, 4).map(c => ({ ...c, listingId: insertedListings[0] }));
    const credenzaComps = sampleComps.slice(4).map(c => ({ ...c, listingId: insertedListings[3] }));
    for (const comp of [...dresserComps, ...credenzaComps]) {
      await db.insert(comparables).values(comp);
    }
    console.log(`  ${dresserComps.length + credenzaComps.length} comparables`);
  }

  console.log('Done. Run `npm run dev` to see the listings.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
