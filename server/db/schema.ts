import { sqliteTable, text, integer, real, uniqueIndex, index, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ============================================================
// Auth (better-auth)
// ============================================================

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
  dailyClaudeLimit: integer('daily_claude_limit').notNull().default(20),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export const claudeUsage = sqliteTable('claude_usage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // 'YYYY-MM-DD'
  callCount: integer('call_count').notNull().default(0),
}, (table) => [
  unique('idx_claude_usage_user_date').on(table.userId, table.date),
]);

// ============================================================
// Phase 1: Deal Finder
// ============================================================

export const listings = sqliteTable('listings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  externalId: text('external_id').notNull(),
  platform: text('platform', { enum: ['craigslist', 'offerup', 'mercari', 'ebay', 'facebook', 'sawbuck'] }).notNull(),
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

  // Analysis error tracking
  analysisError: text('analysis_error'),

  // Multi-user
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
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
  platform: text('platform', { enum: ['craigslist', 'offerup', 'mercari', 'ebay', 'facebook', 'sawbuck'] }).notNull(),
  searchTerm: text('search_term').notNull(),
  category: text('category'),
  location: text('location'),
  minPrice: real('min_price'),
  maxPrice: real('max_price'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  lastRunAt: text('last_run_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
});

export const platformSettings = sqliteTable('platform_settings', {
  platform: text('platform', { enum: ['craigslist', 'offerup', 'mercari', 'ebay', 'facebook', 'sawbuck'] }).primaryKey(),
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
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
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
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
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
  ragSourcesUsed: integer('rag_sources_used').default(0),
  ragSourceTitles: text('rag_source_titles'), // JSON array of title strings
  ragSources: text('rag_sources'), // JSON array of {title, source, type}
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
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
  listingText: text('listing_text'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('idx_projects_status').on(table.status),
  index('idx_projects_listing_id').on(table.listingId),
]);

// ============================================================
// Background Jobs
// ============================================================

export const backgroundJobs = sqliteTable('background_jobs', {
  id: text('id').primaryKey(), // UUID
  type: text('type', { enum: ['scrape', 'analyze'] }).notNull(),
  status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull().default('running'),
  result: text('result'), // JSON
  error: text('error'),
  startedAt: text('started_at').notNull().default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('idx_background_jobs_status').on(table.status),
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
