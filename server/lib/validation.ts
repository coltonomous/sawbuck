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

// ============================================================
// Listing query params
// ============================================================

export const listingQuerySchema = z.object({
  type: z.string().max(100).optional(),
  style: z.string().max(100).optional(),
  minScore: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  platform: z.enum(['craigslist', 'offerup', 'ebay', 'sawbuck']).optional(),
  status: listingStatus.optional(),
  search: z.string().max(200).optional(),
  mine: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sortBy: z.string().max(50).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

// ============================================================
// Render concept
// ============================================================

export const renderConceptSchema = z.object({
  finishType: z.string().min(1).max(50).default('stain'),
  label: z.string().max(100).optional(),
  summary: z.string().max(500).optional(),
});

// ============================================================
// Projects — from concept
// ============================================================

export const createProjectFromConceptSchema = z.object({
  listingId: z.number().int().positive(),
});

// ============================================================
// Project query params
// ============================================================

export const projectQuerySchema = z.object({
  status: z.enum(['acquired', 'refinishing', 'listed', 'sold', 'abandoned']).optional(),
});

// ============================================================
// Admin
// ============================================================

export const updateUserRoleSchema = z.object({
  role: z.enum(['user', 'admin']),
});

export const deleteListingsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

export const updatePlatformSchema = z.object({
  enabled: z.boolean(),
});

export const updateRegionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusMiles: z.number().int().min(1).max(500).optional(),
  clSubdomain: z.string().max(100).nullable().optional(),
  enabled: z.boolean().optional(),
});

export const createRegionSchema = z.object({
  name: z.string().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMiles: z.number().int().min(1).max(500).optional(),
  clSubdomain: z.string().max(100).nullable().optional(),
});
