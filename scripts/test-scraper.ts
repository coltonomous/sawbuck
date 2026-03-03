import { CraigslistScraper } from '../server/scrapers/craigslist.js';
import { OfferUpScraper } from '../server/scrapers/offerup.js';
import { MercariScraper } from '../server/scrapers/mercari.js';
import { closeBrowser } from '../server/scrapers/browser-pool.js';

const platform = process.argv[2] || 'craigslist';
const searchTerm = process.argv[3] || 'mid century dresser';
const location = process.argv[4] || 'sfbay';

const scrapers = {
  craigslist: () => new CraigslistScraper(),
  offerup: () => new OfferUpScraper(),
  mercari: () => new MercariScraper(),
} as const;

async function main() {
  const factory = scrapers[platform as keyof typeof scrapers];
  if (!factory) {
    console.error(`Unknown platform: ${platform}. Use: craigslist, offerup, mercari`);
    process.exit(1);
  }

  console.log(`Testing ${platform} scraper for "${searchTerm}" in ${location}...\n`);

  const scraper = factory();
  try {
    const results = await scraper.scrape({ searchTerm, location });

    console.log(`\nFound ${results.length} listings:\n`);
    for (const r of results.slice(0, 5)) {
      console.log(`  ${r.title}`);
      console.log(`    Price: ${r.askingPrice ? '$' + r.askingPrice : 'N/A'}`);
      console.log(`    URL: ${r.url}`);
      console.log(`    Images: ${r.imageUrls.length}`);
      console.log(`    Location: ${r.location || 'N/A'}`);
      console.log('');
    }

    if (results.length > 5) {
      console.log(`  ... and ${results.length - 5} more`);
    }
  } catch (err) {
    console.error('Scraper error:', err);
  } finally {
    await closeBrowser();
  }
}

main();
