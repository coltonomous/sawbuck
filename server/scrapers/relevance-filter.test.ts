import { describe, it, expect } from 'vitest';
import { isRelevantStrict, isRelevant, filterRelevant } from './relevance-filter.js';

describe('isRelevantStrict', () => {
  describe('exact matches', () => {
    it('matches when title contains the search term', () => {
      expect(isRelevantStrict('Beautiful Oak Dresser', 'dresser')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isRelevantStrict('VINTAGE DRESSER', 'dresser')).toBe(true);
      expect(isRelevantStrict('vintage dresser', 'DRESSER')).toBe(true);
    });

    it('matches whole words only', () => {
      expect(isRelevantStrict('Table lamp shade', 'table')).toBe(true);
      expect(isRelevantStrict('Turntable stand', 'table')).toBe(false);
    });

    it('matches at start of title', () => {
      expect(isRelevantStrict('Dresser 6-drawer walnut', 'dresser')).toBe(true);
    });

    it('matches at end of title', () => {
      expect(isRelevantStrict('Vintage oak dresser', 'dresser')).toBe(true);
    });
  });

  describe('synonym matching', () => {
    it('matches dresser synonyms', () => {
      expect(isRelevantStrict('Antique Bureau with Mirror', 'dresser')).toBe(true);
      expect(isRelevantStrict('Chest of Drawers - Solid Wood', 'dresser')).toBe(true);
      expect(isRelevantStrict('Highboy in walnut finish', 'dresser')).toBe(true);
    });

    it('matches buffet/sideboard synonyms', () => {
      expect(isRelevantStrict('Mid Century Credenza', 'buffet')).toBe(true);
      expect(isRelevantStrict('Vintage Sideboard in Teak', 'buffet')).toBe(true);
      expect(isRelevantStrict('China Cabinet with Hutch', 'buffet')).toBe(true);
    });

    it('matches couch/sofa synonyms', () => {
      expect(isRelevantStrict('Leather Loveseat Excellent Condition', 'couch')).toBe(true);
      expect(isRelevantStrict('MCM Settee with Original Cushions', 'sofa')).toBe(true);
      expect(isRelevantStrict('Sectional 3-piece with Chaise', 'couch')).toBe(true);
    });

    it('matches desk synonyms', () => {
      expect(isRelevantStrict('Roll Top Secretary Desk', 'desk')).toBe(true);
      expect(isRelevantStrict('Writing Table Antique', 'desk')).toBe(true);
    });

    it('matches bookcase synonyms', () => {
      expect(isRelevantStrict('Barrister Bookcase 4 Section', 'bookcase')).toBe(true);
      expect(isRelevantStrict('Display Cabinet Glass Doors', 'bookcase')).toBe(true);
      expect(isRelevantStrict('Curio Cabinet Lighted', 'bookcase')).toBe(true);
    });

    it('matches console/tv stand synonyms', () => {
      expect(isRelevantStrict('TV Stand Entertainment Center', 'console')).toBe(true);
      expect(isRelevantStrict('Entry Table Narrow', 'console')).toBe(true);
      expect(isRelevantStrict('Media Console Low Profile', 'console')).toBe(true);
    });

    it('works bidirectionally — searching credenza finds buffet listings', () => {
      expect(isRelevantStrict('Antique Buffet Server', 'credenza')).toBe(true);
    });
  });

  describe('pluralization', () => {
    it('matches plural form of search term', () => {
      expect(isRelevantStrict('Two Dressers for Sale', 'dresser')).toBe(true);
    });

    it('matches singular when searching with plural', () => {
      expect(isRelevantStrict('Oak Dresser Vintage', 'dressers')).toBe(true);
    });

    it('handles -ves plurals (shelf/shelves)', () => {
      expect(isRelevantStrict('Floating Shelves Set of 3', 'shelf')).toBe(true);
      expect(isRelevantStrict('Wall Shelf Rustic Wood', 'shelves')).toBe(true);
    });

    it('handles -es plurals (bench/benches)', () => {
      expect(isRelevantStrict('Two Benches Outdoor', 'bench')).toBe(true);
    });

    it('handles -s plurals (chair/chairs)', () => {
      expect(isRelevantStrict('Set of 4 Dining Chairs', 'chair')).toBe(true);
      expect(isRelevantStrict('Accent Chair Tufted', 'chairs')).toBe(true);
    });
  });

  describe('negative cases', () => {
    it('rejects titles that do not contain the term or synonyms', () => {
      expect(isRelevantStrict('iPhone 15 Pro Max', 'dresser')).toBe(false);
      expect(isRelevantStrict('Air conditioning unit', 'table')).toBe(false);
      expect(isRelevantStrict('Washing Machine LG Front Load', 'couch')).toBe(false);
    });

    it('rejects partial word matches', () => {
      expect(isRelevantStrict('Turntable vinyl player', 'table')).toBe(false);
      expect(isRelevantStrict('Addressable LED strip', 'dresser')).toBe(false);
    });

    it('rejects similar but non-synonym terms', () => {
      // "chair" and "dining table" are in different groups
      expect(isRelevantStrict('Dining Table Round 48 inch', 'chair')).toBe(false);
    });
  });
});

describe('isRelevant', () => {
  it('delegates to strict matching regardless of platform', () => {
    // All platforms now use strict matching
    expect(isRelevant('Oak Dresser', 'dresser', 'craigslist')).toBe(true);
    expect(isRelevant('Oak Dresser', 'dresser', 'offerup')).toBe(true);
    expect(isRelevant('Oak Dresser', 'dresser', 'mercari')).toBe(true);
    expect(isRelevant('iPhone Case', 'dresser', 'offerup')).toBe(false);
  });
});

describe('filterRelevant', () => {
  const items = [
    { title: 'Vintage Oak Dresser', platform: 'craigslist' },
    { title: 'iPhone 15 Pro Max', platform: 'craigslist' },
    { title: 'Antique Bureau Mirror', platform: 'craigslist' },
    { title: 'Air Conditioner Window Unit', platform: 'craigslist' },
    { title: 'Chest of Drawers Walnut', platform: 'craigslist' },
  ];

  it('keeps relevant items and drops irrelevant ones', () => {
    const result = filterRelevant(items, 'dresser');
    expect(result.relevant.length).toBe(3); // dresser, bureau, chest of drawers
    expect(result.dropped).toBe(2); // iPhone, AC
  });

  it('returns relevant titles that are synonyms', () => {
    const result = filterRelevant(items, 'dresser');
    const titles = result.relevant.map((i) => i.title);
    expect(titles).toContain('Vintage Oak Dresser');
    expect(titles).toContain('Antique Bureau Mirror');
    expect(titles).toContain('Chest of Drawers Walnut');
  });

  it('returns empty relevant list when nothing matches', () => {
    const result = filterRelevant(items, 'rocking chair');
    expect(result.relevant.length).toBe(0);
    expect(result.dropped).toBe(5);
  });

  it('handles empty input', () => {
    const result = filterRelevant([], 'dresser');
    expect(result.relevant).toEqual([]);
    expect(result.dropped).toBe(0);
  });

  it('preserves all items when everything matches', () => {
    const allFurniture = [
      { title: 'Dresser Oak', platform: 'craigslist' },
      { title: 'Bureau Antique', platform: 'craigslist' },
    ];
    const result = filterRelevant(allFurniture, 'dresser');
    expect(result.relevant.length).toBe(2);
    expect(result.dropped).toBe(0);
  });
});
