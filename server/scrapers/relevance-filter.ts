/**
 * Post-scrape relevance filter.
 *
 * Two-tier approach:
 * - Craigslist: Strict synonym matching (CL's problem is keyword spam in descriptions
 *   that makes unrelated items appear in search results)
 * - OfferUp/Mercari: Loose "is this furniture?" filter (their search already returns
 *   related items — we just need to drop obvious non-furniture like appliances)
 */

// Synonym groups — searching for any term in a group should match listings with any other term in that group
const SYNONYM_GROUPS: string[][] = [
  ['buffet', 'sideboard', 'credenza', 'server', 'hutch', 'china cabinet', 'china hutch', 'buffet cabinet', 'buffet table', 'serving cabinet'],
  ['dresser', 'chest of drawers', 'bureau', 'highboy', 'lowboy', 'tallboy', 'chest'],
  ['desk', 'writing desk', 'secretary desk', 'roll top', 'rolltop', 'writing table', 'secretary'],
  ['bookcase', 'bookshelf', 'bookshelves', 'book shelf', 'book case', 'shelving unit', 'display cabinet', 'curio cabinet', 'barrister'],
  ['dining table', 'dining set', 'kitchen table', 'dinette', 'dining room table', 'farm table', 'farmhouse table', 'trestle table'],
  ['coffee table', 'cocktail table'],
  ['end table', 'side table', 'accent table', 'nightstand', 'night stand', 'bedside table'],
  ['armoire', 'wardrobe', 'chifferobe'],
  ['couch', 'sofa', 'loveseat', 'love seat', 'settee', 'sectional', 'davenport', 'divan'],
  ['chair', 'armchair', 'arm chair', 'accent chair', 'lounge chair', 'club chair', 'wingback', 'recliner'],
  ['dining chair', 'dining chairs', 'kitchen chair', 'kitchen chairs', 'side chair'],
  ['bar stool', 'barstool', 'bar stools', 'barstools', 'counter stool'],
  ['cabinet', 'cupboard', 'pantry', 'storage cabinet', 'linen cabinet'],
  ['console', 'console table', 'entry table', 'entryway table', 'hallway table', 'sofa table', 'media console', 'tv stand', 'entertainment center'],
  ['vanity', 'vanity table', 'makeup table', 'dressing table'],
  ['bed', 'bed frame', 'headboard', 'footboard', 'bedframe', 'platform bed', 'canopy bed', 'four poster'],
  ['mirror', 'wall mirror', 'floor mirror', 'vanity mirror'],
  ['lamp', 'floor lamp', 'table lamp', 'desk lamp', 'chandelier', 'pendant light', 'sconce'],
  ['bench', 'storage bench', 'entryway bench', 'hall bench', 'ottoman', 'footstool'],
  ['shelf', 'shelves', 'floating shelf', 'wall shelf', 'shelf unit'],
  ['table', 'accent table', 'occasional table', 'parlor table', 'game table', 'card table'],
];

// All furniture terms from all synonym groups — used for the loose "is furniture?" check
const ALL_FURNITURE_TERMS: string[] = [];
for (const group of SYNONYM_GROUPS) {
  for (const term of group) {
    ALL_FURNITURE_TERMS.push(term.toLowerCase());
  }
}

// Additional furniture keywords not in synonym groups but still clearly furniture
const EXTRA_FURNITURE_KEYWORDS = [
  'furniture', 'antique', 'vintage', 'mid century', 'midcentury', 'mcm',
  'wood', 'wooden', 'oak', 'maple', 'walnut', 'mahogany', 'teak', 'cherry', 'pine', 'birch', 'cedar', 'rosewood',
  'hutch', 'credenza', 'armoire', 'chaise', 'futon', 'rocker', 'rocking chair',
  'buffet server', 'china cabinet', 'wine rack', 'bar cart',
  'entertainment center', 'tv console', 'media cabinet',
  'file cabinet', 'filing cabinet',
  'hope chest', 'blanket chest', 'toy chest', 'cedar chest',
  'étagère', 'etagere', 'whatnot', 'curio',
  'credenza', 'console table', 'hall tree',
  'dining room', 'living room', 'bedroom',
];

// Build a lookup: term → set of all terms that should match (strict mode)
const synonymMap = new Map<string, Set<string>>();
for (const group of SYNONYM_GROUPS) {
  const allTerms = new Set(group.map(t => t.toLowerCase()));
  for (const term of group) {
    const existing = synonymMap.get(term.toLowerCase());
    if (existing) {
      for (const t of allTerms) existing.add(t);
    } else {
      synonymMap.set(term.toLowerCase(), new Set(allTerms));
    }
  }
}

/**
 * Naive pluralization: strip trailing 's' or 'es' to get singular form.
 * Only handles common English plural patterns — not comprehensive but good enough for furniture terms.
 */
function depluralize(word: string): string {
  if (word.endsWith('ves')) return word.slice(0, -3) + 'f'; // shelves → shelf
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y'; // vanities → vanity
  if (word.endsWith('ses') || word.endsWith('ches') || word.endsWith('shes') || word.endsWith('xes')) {
    return word.slice(0, -2); // benches → bench, cases → case
  }
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1); // chairs → chair
  return word;
}

/**
 * Check if term matches in title, handling plurals.
 * Returns true if the term (or its plural/singular form) appears as a whole word in the title.
 */
function termMatchesInTitle(titleLower: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match whole word: preceded/followed by non-letter or string boundary
  const regex = new RegExp(`(?:^|[^a-z])${escaped}(?:s|es)?(?:[^a-z]|$)`, 'i');
  if (regex.test(titleLower)) return true;

  // Also try the depluralized form of the term
  const singular = depluralize(term);
  if (singular !== term) {
    const escapedSingular = singular.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexSingular = new RegExp(`(?:^|[^a-z])${escapedSingular}(?:s|es)?(?:[^a-z]|$)`, 'i');
    if (regexSingular.test(titleLower)) return true;
  }

  return false;
}

/**
 * Get all terms that should count as a match for the given search term (strict mode).
 * Returns the search term itself plus all synonyms.
 */
function getMatchTerms(searchTerm: string): string[] {
  const lower = searchTerm.toLowerCase().trim();
  const synonyms = synonymMap.get(lower);
  if (synonyms) return [...synonyms];

  // Try depluralized form
  const singular = depluralize(lower);
  if (singular !== lower) {
    const synonymsSingular = synonymMap.get(singular);
    if (synonymsSingular) return [lower, ...synonymsSingular];
  }

  // Check if search term is a substring of any synonym group entry
  for (const [key, group] of synonymMap) {
    if (key.includes(lower) || lower.includes(key)) {
      return [lower, ...group];
    }
  }

  return [lower];
}

/**
 * STRICT check: title contains the search term or any synonym.
 * Used for Craigslist where keyword spam is the problem.
 */
export function isRelevantStrict(title: string, searchTerm: string): boolean {
  const titleLower = title.toLowerCase();
  const matchTerms = getMatchTerms(searchTerm);

  for (const term of matchTerms) {
    if (termMatchesInTitle(titleLower, term)) return true;
  }

  return false;
}

/**
 * LOOSE check: title mentions any furniture term at all.
 * Used for OfferUp/Mercari where their search already returns related items
 * and we just need to drop obvious non-furniture (appliances, cleaning products, etc).
 */
export function isFurniture(title: string): boolean {
  const titleLower = title.toLowerCase();

  // Check all synonym group terms
  for (const term of ALL_FURNITURE_TERMS) {
    if (termMatchesInTitle(titleLower, term)) return true;
  }

  // Check extra furniture keywords
  for (const kw of EXTRA_FURNITURE_KEYWORDS) {
    if (titleLower.includes(kw)) return true;
  }

  return false;
}

/**
 * Combined check used by isRelevant — strict synonym matching for all platforms.
 * Previously OfferUp/Mercari used a loose "is furniture?" check, but that lets through
 * too much junk when the search term fans across all platforms.
 */
export function isRelevant(title: string, searchTerm: string, _platform?: string): boolean {
  return isRelevantStrict(title, searchTerm);
}

/**
 * Filter a list of scraped listings to only relevant results.
 * Returns { relevant, dropped } for logging.
 */
export function filterRelevant<T extends { title: string; platform?: string }>(
  items: T[],
  searchTerm: string,
  platform?: string,
): { relevant: T[]; dropped: number } {
  const relevant: T[] = [];
  let dropped = 0;

  for (const item of items) {
    const p = platform ?? (item as any).platform;
    if (isRelevant(item.title, searchTerm, p)) {
      relevant.push(item);
    } else {
      dropped++;
    }
  }

  return { relevant, dropped };
}
