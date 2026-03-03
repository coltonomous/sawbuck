import { sqlite } from '../server/db/index.js';
import { isRelevantStrict } from '../server/scrapers/relevance-filter.js';

const configs = sqlite.prepare('SELECT search_term FROM search_configs WHERE is_active = 1').all() as any[];
const searchTerms: string[] = configs.map((c: any) => c.search_term);
console.log('Active search terms:', searchTerms);

if (searchTerms.length === 0) {
  console.log('No active search terms — aborting');
  process.exit(0);
}

// Find listings that don't match ANY active search term (skip acquired/watching — user chose those)
const allListings = sqlite.prepare(
  "SELECT id, title, platform, status FROM listings WHERE status NOT IN ('acquired', 'watching')"
).all() as any[];

const toDelete: number[] = [];
for (const l of allListings) {
  let matchesAny = false;
  for (const term of searchTerms) {
    if (isRelevantStrict(l.title, term)) {
      matchesAny = true;
      break;
    }
  }
  if (!matchesAny) toDelete.push(l.id);
}

console.log(`Total non-acquired/watching listings: ${allListings.length}`);
console.log(`Irrelevant (will delete): ${toDelete.length}`);
console.log(`Relevant (will keep): ${allListings.length - toDelete.length}`);

for (const id of toDelete) {
  sqlite.prepare('DELETE FROM listing_images WHERE listing_id = ?').run(id);
  sqlite.prepare('DELETE FROM comparables WHERE listing_id = ?').run(id);
  sqlite.prepare('DELETE FROM listings WHERE id = ?').run(id);
}

console.log(`Deleted ${toDelete.length} irrelevant listings`);
