import { z } from 'zod';

// ============================================================
// Listings
// ============================================================

export const createSawbuckListingSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  askingPrice: z.number().nonnegative(),
  location: z.string().max(200).optional(),
});

export const editSawbuckListingSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable(),
  askingPrice: z.number().nonnegative(),
  location: z.string().max(200).nullable(),
}).partial();

const listingStatus = z.enum(['new', 'analyzed', 'watching', 'acquired', 'dismissed', 'removed']);

export const updateListingSchema = z.object({
  status: listingStatus,
}).partial().strict();

export const bulkUpdateListingsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
  updates: z.object({
    status: listingStatus,
  }).partial().strict(),
});

// ============================================================
// Projects
// ============================================================

const projectStatus = z.enum(['acquired', 'refinishing', 'listed', 'sold', 'abandoned']);

export const createProjectSchema = z.object({
  listingId: z.number().int().positive(),
  name: z.string().min(1).max(200),
  purchasePrice: z.number().nonnegative(),
  purchaseDate: z.string().optional(),
  purchaseNotes: z.string().max(2000).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  status: projectStatus,
  purchasePrice: z.number().nonnegative(),
  purchaseDate: z.string().nullable(),
  purchaseNotes: z.string().max(2000).nullable(),
  notes: z.string().max(5000).nullable(),
}).partial().strict();

export const updateCostsSchema = z.object({
  hoursInvested: z.number().nonnegative(),
  hourlyRate: z.number().nonnegative(),
  soldPrice: z.number().nonnegative(),
  soldDate: z.string().nullable(),
  listedPrice: z.number().nonnegative(),
  listedDate: z.string().nullable(),
  listedPlatform: z.string().max(100).nullable(),
  sellingFees: z.number().nonnegative(),
  shippingCost: z.number().nonnegative(),
}).partial().strict();

export const updateMaterialSchema = z.object({
  purchased: z.boolean(),
  actualPrice: z.number().nonnegative().nullable(),
}).partial().strict();

export const generateListingTextSchema = z.object({
  regenerate: z.boolean().optional().default(false),
});

// ============================================================
// Ratings
// ============================================================

const ratingScore = z.number().int().min(1).max(5);

export const submitAnalysisRatingSchema = z.object({
  overallRating: ratingScore,
  conditionAccuracy: ratingScore.optional(),
  woodIdAccuracy: ratingScore.optional(),
  priceAccuracy: ratingScore.optional(),
  recommendationHelpful: ratingScore.optional(),
  feedback: z.string().max(2000).optional(),
});

export const submitPlanRatingSchema = z.object({
  overallRating: ratingScore,
  stepClarity: ratingScore.optional(),
  timeAccuracy: ratingScore.optional(),
  materialAccuracy: ratingScore.optional(),
  resultQuality: ratingScore.optional(),
  feedback: z.string().max(2000).optional(),
});

// ============================================================
// Scrapers
// ============================================================

const platform = z.enum(['craigslist', 'offerup', 'ebay']);

export const runScraperSchema = z.object({
  platform: platform,
  searchTerm: z.string().min(1),
  location: z.string().optional(),
  minPrice: z.number().nonnegative().optional(),
  maxPrice: z.number().nonnegative().optional(),
}).partial();

export const addSearchConfigSchema = z.object({
  platform: z.string().default('all'),
  searchTerm: z.string().min(1).max(200),
  category: z.string().max(100).optional(),
  location: z.string().max(200).optional(),
  minPrice: z.number().nonnegative().optional(),
  maxPrice: z.number().nonnegative().optional(),
});

export const togglePlatformSchema = z.object({
  enabled: z.boolean(),
});

const SUPPORTED_LISTING_HOSTS = [
  /^([a-z]+\.)?craigslist\.org$/,
  /^(www\.)?offerup\.com$/,
  /^(www\.)?ebay\.com$/,
];

export const importListingSchema = z.object({
  url: z.string()
    .trim()
    .transform((val) => {
      // Strip common tracking params
      try {
        const u = new URL(val);
        // Only allow http/https
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return val; // will fail host check below
        }
        for (const key of [...u.searchParams.keys()]) {
          if (/^(utm_|fbclid|gclid|ref|si|_trkparms|_trksid|hash|sxsrf)/.test(key)) {
            u.searchParams.delete(key);
          }
        }
        return u.toString();
      } catch {
        return val;
      }
    })
    .refine((val) => {
      try {
        const u = new URL(val);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch { return false; }
    }, { message: 'Must be a valid HTTP(S) URL' })
    .refine((val) => {
      try {
        const host = new URL(val).hostname;
        return SUPPORTED_LISTING_HOSTS.some((re) => re.test(host));
      } catch { return false; }
    }, { message: 'Unsupported platform. Supported: Craigslist, OfferUp, eBay.' }),
});

// ============================================================
// Comparables
// ============================================================

export const searchComparablesSchema = z.object({
  listingId: z.number().int().positive().optional(),
  query: z.string().min(1).max(200).optional(),
}).refine(data => data.listingId || data.query, {
  message: 'Either listingId or query is required',
});
