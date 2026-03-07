// Canonical source for all enums, lookup maps, and display constants.
// Imported by both server/ and client/.

export const PLATFORMS = ['craigslist', 'offerup', 'mercari', 'ebay'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const LISTING_STATUSES = ['new', 'analyzed', 'watching', 'acquired', 'dismissed'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const PROJECT_STATUSES = ['acquired', 'refinishing', 'listed', 'sold', 'abandoned'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_PIPELINE_STATUSES = ['acquired', 'refinishing', 'listed', 'sold'] as const;

export const PHOTO_TYPES = ['before', 'during', 'after'] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

export const DIFFICULTY_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export const DOWNLOAD_STATUSES = ['pending', 'downloaded', 'failed'] as const;
export const ANALYSIS_STATUSES = ['pending', 'analyzed', 'skipped', 'failed'] as const;
export const SCRAPE_RUN_STATUSES = ['running', 'completed', 'failed'] as const;

export const FLIP_RECOMMENDATIONS = ['strong_buy', 'buy', 'maybe', 'pass'] as const;
export type FlipRecommendation = (typeof FLIP_RECOMMENDATIONS)[number];

export const REFINISHING_POTENTIALS = ['high', 'medium', 'low'] as const;

// -- Display labels --------------------------------------------------------

export const PLATFORM_LABELS: Record<Platform, string> = {
  craigslist: 'Craigslist',
  offerup: 'OfferUp',
  ebay: 'eBay',
  mercari: 'Mercari',
};

// -- UI colors (Tailwind classes) ------------------------------------------

export const PLATFORM_BADGE_COLORS: Record<Platform, string> = {
  craigslist: 'bg-purple-100 text-purple-700',
  offerup: 'bg-teal-100 text-teal-700',
  ebay: 'bg-blue-100 text-blue-700',
  mercari: 'bg-orange-100 text-orange-700',
};

export const PLATFORM_DOT_COLORS: Record<Platform, string> = {
  craigslist: 'bg-purple-500',
  offerup: 'bg-teal-500',
  ebay: 'bg-blue-500',
  mercari: 'bg-orange-500',
};

export const LISTING_STATUS_COLORS: Record<ListingStatus, string> = {
  new: 'bg-blue-50 text-blue-600',
  analyzed: 'bg-green-50 text-green-600',
  watching: 'bg-amber-50 text-amber-600',
  acquired: 'bg-purple-50 text-purple-600',
  dismissed: 'bg-gray-100 text-gray-400',
};

export const PROJECT_STATUS_META: Record<string, { bg: string; text: string; header: string; dot: string }> = {
  acquired: { bg: 'bg-amber-50/60', text: 'text-amber-700', header: 'bg-amber-100/80', dot: 'bg-amber-500' },
  refinishing: { bg: 'bg-orange-50/60', text: 'text-orange-700', header: 'bg-orange-100/80', dot: 'bg-orange-500' },
  listed: { bg: 'bg-blue-50/60', text: 'text-blue-700', header: 'bg-blue-100/80', dot: 'bg-blue-500' },
  sold: { bg: 'bg-green-50/60', text: 'text-green-700', header: 'bg-green-100/80', dot: 'bg-green-500' },
};

export const FLIP_REC_COLORS: Record<FlipRecommendation, { bg: string; label: string }> = {
  strong_buy: { bg: 'bg-green-100 text-green-700', label: 'Strong Buy' },
  buy: { bg: 'bg-blue-100 text-blue-700', label: 'Buy' },
  maybe: { bg: 'bg-yellow-100 text-yellow-700', label: 'Maybe' },
  pass: { bg: 'bg-red-100 text-red-700', label: 'Pass' },
};

// -- Deal score thresholds -------------------------------------------------

export const DEAL_SCORE_THRESHOLDS = { great: 2, good: 1.5 } as const;

export function dealScoreColor(score: number): string {
  return score >= DEAL_SCORE_THRESHOLDS.great ? 'bg-green-500'
    : score >= DEAL_SCORE_THRESHOLDS.good ? 'bg-yellow-500'
    : 'bg-gray-300';
}

export function dealScoreTextColor(score: number): string {
  return score >= DEAL_SCORE_THRESHOLDS.great ? 'text-green-700'
    : score >= DEAL_SCORE_THRESHOLDS.good ? 'text-yellow-700'
    : 'text-gray-500';
}

// -- Chart colors ----------------------------------------------------------

export const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'] as const;

// -- Craigslist city/subdomain mapping -------------------------------------

export const CL_SUBDOMAINS: Record<string, string> = {
  'seattle': 'seattle', 'kent': 'seattle', 'tacoma': 'seattle', 'bellevue': 'seattle', 'renton': 'seattle', 'everett': 'seattle', 'redmond': 'seattle', 'kirkland': 'seattle', 'olympia': 'seattle', 'auburn': 'seattle',
  'portland': 'portland', 'beaverton': 'portland', 'hillsboro': 'portland', 'gresham': 'portland',
  'sf': 'sfbay', 'sfbay': 'sfbay', 'san francisco': 'sfbay', 'oakland': 'sfbay', 'san jose': 'sfbay', 'berkeley': 'sfbay', 'fremont': 'sfbay', 'palo alto': 'sfbay',
  'la': 'losangeles', 'los angeles': 'losangeles', 'losangeles': 'losangeles', 'pasadena': 'losangeles', 'long beach': 'losangeles', 'glendale': 'losangeles', 'burbank': 'losangeles',
  'san diego': 'sandiego', 'sandiego': 'sandiego',
  'sacramento': 'sacramento',
  'phoenix': 'phoenix', 'mesa': 'phoenix', 'scottsdale': 'phoenix', 'tempe': 'phoenix', 'chandler': 'phoenix', 'gilbert': 'phoenix',
  'denver': 'denver', 'aurora': 'denver', 'boulder': 'boulder',
  'chicago': 'chicago', 'evanston': 'chicago', 'naperville': 'chicago',
  'new york': 'newyork', 'newyork': 'newyork', 'nyc': 'newyork', 'brooklyn': 'newyork', 'queens': 'newyork', 'manhattan': 'newyork', 'bronx': 'newyork',
  'austin': 'austin', 'houston': 'houston', 'dallas': 'dallas', 'san antonio': 'sanantonio',
  'atlanta': 'atlanta', 'miami': 'miami', 'tampa': 'tampa', 'orlando': 'orlando',
  'boston': 'boston', 'detroit': 'detroit', 'minneapolis': 'minneapolis', 'dc': 'washingtondc', 'washington': 'washingtondc', 'washington dc': 'washingtondc',
  'philadelphia': 'philadelphia', 'philly': 'philadelphia', 'pittsburgh': 'pittsburgh',
  'las vegas': 'lasvegas', 'vegas': 'lasvegas', 'reno': 'reno',
  'nashville': 'nashville', 'memphis': 'memphis', 'charlotte': 'charlotte', 'raleigh': 'raleigh',
  'columbus': 'columbus', 'cincinnati': 'cincinnati', 'cleveland': 'cleveland',
  'salt lake': 'saltlakecity', 'salt lake city': 'saltlakecity', 'slc': 'saltlakecity',
  'indianapolis': 'indianapolis', 'milwaukee': 'milwaukee', 'kansas city': 'kansascity',
  'st louis': 'stlouis', 'stlouis': 'stlouis',
  'honolulu': 'honolulu', 'anchorage': 'anchorage',
};

export const CL_DISPLAY_NAMES: Record<string, string> = {
  'sfbay': 'SF Bay Area', 'losangeles': 'Los Angeles', 'sandiego': 'San Diego',
  'newyork': 'New York', 'washingtondc': 'Washington DC', 'saltlakecity': 'Salt Lake City',
  'kansascity': 'Kansas City', 'stlouis': 'St. Louis', 'sanantonio': 'San Antonio',
  'lasvegas': 'Las Vegas',
};

export function resolveClSubdomain(location: string): string {
  return CL_SUBDOMAINS[location.toLowerCase().trim()] || location.toLowerCase().trim();
}

export function clDisplayLocation(subdomain: string): string {
  return CL_DISPLAY_NAMES[subdomain] || subdomain.charAt(0).toUpperCase() + subdomain.slice(1);
}
