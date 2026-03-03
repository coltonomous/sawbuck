import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ============================================================
// Phase 1: Deal Finder
// ============================================================

export const listings = sqliteTable('listings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  externalId: text('external_id').notNull(),
  platform: text('platform', { enum: ['craigslist', 'offerup', 'mercari', 'ebay'] }).notNull(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  askingPrice: real('asking_price'),
  location: text('location'),
  latitude: real('latitude'),
  longitude: real('longitude'),
  sellerName: text('seller_name'),
  postedAt: text('posted_at'),
  scrapedAt: text('scraped_at').notNull().default(sql`(datetime('now'))`),
  status: text('status', { enum: ['new', 'analyzed', 'watching', 'acquired', 'dismissed'] }).notNull().default('new'),

  // Claude Vision analysis
  furnitureType: text('furniture_type'),
  furnitureStyle: text('furniture_style'),
  conditionScore: real('condition_score'),
  conditionNotes: text('condition_notes'),
  woodSpecies: text('wood_species'),
  woodConfidence: real('wood_confidence'),
  analysisRaw: text('analysis_raw'),
  analyzedAt: text('analyzed_at'),

  // Pricing
  estimatedValue: real('estimated_value'),
  estimatedRefinishedValue: real('estimated_refinished_value'),
  dealScore: real('deal_score'),

  // Search matching — JSON array of search terms that found this listing
  matchedSearchTerms: text('matched_search_terms'),

  // Deduplication
  fingerprint: text('fingerprint'),
}, (table) => [
  uniqueIndex('idx_listings_platform_external').on(table.platform, table.externalId),
  index('idx_listings_status').on(table.status),
  index('idx_listings_deal_score').on(table.dealScore),
  index('idx_listings_platform').on(table.platform),
  index('idx_listings_furniture_type').on(table.furnitureType),
  index('idx_listings_scraped_at').on(table.scrapedAt),
  index('idx_listings_fingerprint').on(table.fingerprint),
]);

export const listingImages = sqliteTable('listing_images', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  listingId: integer('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  sourceUrl: text('source_url').notNull(),
  localPathOriginal: text('local_path_original'),
  localPathResized: text('local_path_resized'),
  width: integer('width'),
  height: integer('height'),
  fileSizeBytes: integer('file_size_bytes'),
  downloadStatus: text('download_status', { enum: ['pending', 'downloaded', 'failed'] }).notNull().default('pending'),
  analysisStatus: text('analysis_status', { enum: ['pending', 'analyzed', 'skipped', 'failed'] }).notNull().default('pending'),
  analysisResult: text('analysis_result'),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_listing_images_listing_id').on(table.listingId),
  index('idx_listing_images_download_status').on(table.downloadStatus),
]);

export const searchConfigs = sqliteTable('search_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  platform: text('platform', { enum: ['craigslist', 'offerup', 'mercari', 'ebay'] }).notNull(),
  searchTerm: text('search_term').notNull(),
  category: text('category'),
  location: text('location'),
  minPrice: real('min_price'),
  maxPrice: real('max_price'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  lastRunAt: text('last_run_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const platformSettings = sqliteTable('platform_settings', {
  platform: text('platform', { enum: ['craigslist', 'offerup', 'mercari', 'ebay'] }).primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
});

export const scrapeRuns = sqliteTable('scrape_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  platform: text('platform').notNull(),
  searchConfigId: integer('search_config_id').references(() => searchConfigs.id),
  startedAt: text('started_at').notNull().default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
  listingsFound: integer('listings_found').default(0),
  listingsNew: integer('listings_new').default(0),
  listingsDuplicate: integer('listings_duplicate').default(0),
  error: text('error'),
  status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull().default('running'),
});

export const comparables = sqliteTable('comparables', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  listingId: integer('listing_id').references(() => listings.id),
  source: text('source').notNull().default('ebay'),
  sourceUrl: text('source_url'),
  title: text('title').notNull(),
  soldPrice: real('sold_price').notNull(),
  soldDate: text('sold_date'),
  condition: text('condition'),
  furnitureType: text('furniture_type'),
  furnitureStyle: text('furniture_style'),
  searchQuery: text('search_query'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_comparables_listing_id').on(table.listingId),
  index('idx_comparables_furniture_type').on(table.furnitureType),
]);

// ============================================================
// Phase 2: Refinishing Advisor
// ============================================================

export const refinishingPlans = sqliteTable('refinishing_plans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  listingId: integer('listing_id').notNull().references(() => listings.id),
  projectId: integer('project_id'),
  styleRecommendation: text('style_recommendation'),
  description: text('description'),
  steps: text('steps').notNull(), // JSON array
  estimatedHours: real('estimated_hours'),
  estimatedMaterialCost: real('estimated_material_cost'),
  estimatedResalePrice: real('estimated_resale_price'),
  difficultyLevel: text('difficulty_level', { enum: ['beginner', 'intermediate', 'advanced'] }),
  beforeDescription: text('before_description'),
  afterDescription: text('after_description'),
  rawResponse: text('raw_response'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_refinishing_plans_listing_id').on(table.listingId),
]);

// ============================================================
// Phase 3: Parts Sourcing
// ============================================================

export const materials = sqliteTable('materials', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  refinishingPlanId: integer('refinishing_plan_id').notNull().references(() => refinishingPlans.id, { onDelete: 'cascade' }),
  projectId: integer('project_id'),
  category: text('category').notNull(),
  productName: text('product_name').notNull(),
  brand: text('brand'),
  quantity: real('quantity').notNull().default(1),
  unit: text('unit'),
  estimatedPrice: real('estimated_price'),
  actualPrice: real('actual_price'),
  purchased: integer('purchased', { mode: 'boolean' }).notNull().default(false),
  amazonSearchUrl: text('amazon_search_url'),
  homeDepotSearchUrl: text('home_depot_search_url'),
  lowesSearchUrl: text('lowes_search_url'),
  notes: text('notes'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_materials_plan_id').on(table.refinishingPlanId),
  index('idx_materials_project_id').on(table.projectId),
]);

// ============================================================
// Phase 4: Project Tracking
// ============================================================

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  listingId: integer('listing_id').notNull().references(() => listings.id),
  name: text('name').notNull(),
  status: text('status', { enum: ['acquired', 'refinishing', 'listed', 'sold', 'abandoned'] }).notNull().default('acquired'),

  // Cost tracking
  purchasePrice: real('purchase_price').notNull(),
  purchaseDate: text('purchase_date'),
  purchaseNotes: text('purchase_notes'),
  totalMaterialCost: real('total_material_cost').default(0),
  hoursInvested: real('hours_invested').default(0),
  hourlyRate: real('hourly_rate').default(25),

  // Sale tracking
  listedPrice: real('listed_price'),
  listedDate: text('listed_date'),
  listedPlatform: text('listed_platform'),
  soldPrice: real('sold_price'),
  soldDate: text('sold_date'),
  sellingFees: real('selling_fees').default(0),
  shippingCost: real('shipping_cost').default(0),

  // Calculated
  totalCost: real('total_cost'),
  profit: real('profit'),
  roiPercentage: real('roi_percentage'),

  notes: text('notes'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_projects_status').on(table.status),
  index('idx_projects_listing_id').on(table.listingId),
]);

export const projectPhotos = sqliteTable('project_photos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  photoType: text('photo_type', { enum: ['before', 'during', 'after'] }).notNull(),
  localPath: text('local_path').notNull(),
  caption: text('caption'),
  takenAt: text('taken_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_project_photos_project_id').on(table.projectId),
]);
