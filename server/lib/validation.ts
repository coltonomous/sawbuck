import { z } from 'zod';

// ============================================================
// Listings
// ============================================================

const listingStatus = z.enum(['new', 'analyzed', 'watching', 'acquired', 'dismissed']);

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

const platform = z.enum(['craigslist', 'offerup', 'mercari', 'ebay']);

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

// ============================================================
// Comparables
// ============================================================

export const searchComparablesSchema = z.object({
  listingId: z.number().int().positive().optional(),
  query: z.string().min(1).max(200).optional(),
}).refine(data => data.listingId || data.query, {
  message: 'Either listingId or query is required',
});
