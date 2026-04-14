import { pgTable, text, integer, real, serial, boolean, timestamp, uniqueIndex, index, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ============================================================
// Auth (better-auth)
// ============================================================

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),

  // User preferences (for filtering agent-discovered listings)
  preferredLatitude: real('preferred_latitude'),
  preferredLongitude: real('preferred_longitude'),
  preferredRadiusMiles: integer('preferred_radius_miles').default(25),
  maxBudget: real('max_budget'),
  shopSpace: text('shop_space', { enum: ['small_workshop', 'one_car_garage', 'two_car_garage', 'full_shop'] }),
  experienceLevel: text('experience_level', { enum: ['beginner', 'intermediate', 'advanced'] }),
  stylePreferences: text('style_preferences'),

  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_accounts_provider_account').on(table.providerId, table.accountId),
]);

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

// ============================================================
// Phase 1: Deal Finder
// ============================================================

export const listings = pgTable('listings', {
  id: serial('id').primaryKey(),
  externalId: text('external_id').notNull(),
  platform: text('platform', { enum: ['craigslist', 'offerup', 'ebay', 'sawbuck'] }).notNull(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  askingPrice: real('asking_price'),
  location: text('location'),
  latitude: real('latitude'),
  longitude: real('longitude'),
  sellerName: text('seller_name'),
  postedAt: timestamp('posted_at'),
  scrapedAt: timestamp('scraped_at').notNull().defaultNow(),
  status: text('status', { enum: ['new', 'analyzed', 'watching', 'acquired', 'dismissed', 'removed'] }).notNull().default('new'),

  furnitureType: text('furniture_type'),
  furnitureStyle: text('furniture_style'),
  conditionScore: real('condition_score'),
  conditionNotes: text('condition_notes'),
  woodSpecies: text('wood_species'),
  woodConfidence: real('wood_confidence'),
  analysisRaw: text('analysis_raw'),
  analyzedAt: timestamp('analyzed_at'),

  estimatedValue: real('estimated_value'),
  estimatedRefinishedValue: real('estimated_refinished_value'),
  dealScore: real('deal_score'),

  matchedSearchTerms: text('matched_search_terms'),
  fingerprint: text('fingerprint'),
  analysisError: text('analysis_error'),

  triageSource: text('triage_source', { enum: ['manual', 'agent_triage', 'agent_eval'] }),
  agentRunId: text('agent_run_id'),

  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('idx_listings_platform_external').on(table.platform, table.externalId),
  index('idx_listings_status').on(table.status),
  index('idx_listings_deal_score').on(table.dealScore),
  index('idx_listings_platform').on(table.platform),
  index('idx_listings_furniture_type').on(table.furnitureType),
  index('idx_listings_scraped_at').on(table.scrapedAt),
  index('idx_listings_fingerprint').on(table.fingerprint),
  index('idx_listings_user_id').on(table.userId),
  index('idx_listings_user_platform').on(table.userId, table.platform),
  index('idx_listings_status_deal_score').on(table.status, table.dealScore),
]);

export const listingImages = pgTable('listing_images', {
  id: serial('id').primaryKey(),
  listingId: integer('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  sourceUrl: text('source_url').notNull(),
  localPathOriginal: text('local_path_original'),
  localPathResized: text('local_path_resized'),
  width: integer('width'),
  height: integer('height'),
  fileSizeBytes: integer('file_size_bytes'),
  downloadStatus: text('download_status', { enum: ['pending', 'downloaded', 'failed', 'cleaned'] }).notNull().default('pending'),
  analysisStatus: text('analysis_status', { enum: ['pending', 'analyzed', 'skipped', 'failed'] }).notNull().default('pending'),
  analysisResult: text('analysis_result'),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('idx_listing_images_listing_id').on(table.listingId),
  index('idx_listing_images_download_status').on(table.downloadStatus),
]);

export const searchConfigs = pgTable('search_configs', {
  id: serial('id').primaryKey(),
  platform: text('platform', { enum: ['craigslist', 'offerup', 'ebay', 'sawbuck'] }).notNull(),
  searchTerm: text('search_term').notNull(),
  category: text('category'),
  location: text('location'),
  minPrice: real('min_price'),
  maxPrice: real('max_price'),
  isActive: boolean('is_active').notNull().default(true),
  lastRunAt: timestamp('last_run_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
});

export const platformSettings = pgTable('platform_settings', {
  platform: text('platform', { enum: ['craigslist', 'offerup', 'ebay', 'sawbuck'] }).primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
});

// ============================================================
// User Activity Tracking
// ============================================================

export const listingClicks = pgTable('listing_clicks', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  listingId: integer('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ============================================================
// User Dismissals (per-user, does not affect other users)
// ============================================================

export const userDismissals = pgTable('user_dismissals', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  listingId: integer('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_user_dismissals_unique').on(table.userId, table.listingId),
]);

export const scrapeRuns = pgTable('scrape_runs', {
  id: serial('id').primaryKey(),
  platform: text('platform').notNull(),
  searchConfigId: integer('search_config_id').references(() => searchConfigs.id),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  listingsFound: integer('listings_found').default(0),
  listingsNew: integer('listings_new').default(0),
  listingsDuplicate: integer('listings_duplicate').default(0),
  error: text('error'),
  status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull().default('running'),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
});

export const comparables = pgTable('comparables', {
  id: serial('id').primaryKey(),
  listingId: integer('listing_id').references(() => listings.id, { onDelete: 'cascade' }),
  source: text('source').notNull().default('ebay'),
  sourceUrl: text('source_url'),
  title: text('title').notNull(),
  soldPrice: real('sold_price').notNull(),
  soldDate: timestamp('sold_date'),
  condition: text('condition'),
  furnitureType: text('furniture_type'),
  furnitureStyle: text('furniture_style'),
  searchQuery: text('search_query'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('idx_comparables_listing_id').on(table.listingId),
  index('idx_comparables_furniture_type').on(table.furnitureType),
]);

// ============================================================
// Phase 2: Refinishing Advisor
// ============================================================

export const refinishingPlans = pgTable('refinishing_plans', {
  id: serial('id').primaryKey(),
  listingId: integer('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  styleRecommendation: text('style_recommendation'),
  description: text('description'),
  steps: text('steps').notNull(),
  estimatedHours: real('estimated_hours'),
  estimatedMaterialCost: real('estimated_material_cost'),
  estimatedResalePrice: real('estimated_resale_price'),
  difficultyLevel: text('difficulty_level', { enum: ['beginner', 'intermediate', 'advanced'] }),
  beforeDescription: text('before_description'),
  afterDescription: text('after_description'),
  rawResponse: text('raw_response'),
  ragSourcesUsed: integer('rag_sources_used').default(0),
  ragSourceTitles: text('rag_source_titles'),
  ragSources: text('rag_sources'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('idx_refinishing_plans_listing_id').on(table.listingId),
]);

// ============================================================
// Phase 3: Parts Sourcing
// ============================================================

export const materials = pgTable('materials', {
  id: serial('id').primaryKey(),
  refinishingPlanId: integer('refinishing_plan_id').notNull().references(() => refinishingPlans.id, { onDelete: 'cascade' }),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  category: text('category').notNull(),
  productName: text('product_name').notNull(),
  brand: text('brand'),
  quantity: real('quantity').notNull().default(1),
  unit: text('unit'),
  estimatedPrice: real('estimated_price'),
  actualPrice: real('actual_price'),
  purchased: boolean('purchased').notNull().default(false),
  amazonSearchUrl: text('amazon_search_url'),
  homeDepotSearchUrl: text('home_depot_search_url'),
  lowesSearchUrl: text('lowes_search_url'),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('idx_materials_plan_id').on(table.refinishingPlanId),
  index('idx_materials_project_id').on(table.projectId),
]);

// ============================================================
// Phase 4: Project Tracking
// ============================================================

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  listingId: integer('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status', { enum: ['acquired', 'refinishing', 'listed', 'sold', 'abandoned'] }).notNull().default('acquired'),

  purchasePrice: real('purchase_price').notNull(),
  purchaseDate: timestamp('purchase_date'),
  purchaseNotes: text('purchase_notes'),
  totalMaterialCost: real('total_material_cost').default(0),
  hoursInvested: real('hours_invested').default(0),
  hourlyRate: real('hourly_rate').default(25),

  listedPrice: real('listed_price'),
  listedDate: timestamp('listed_date'),
  listedPlatform: text('listed_platform'),
  soldPrice: real('sold_price'),
  soldDate: timestamp('sold_date'),
  sellingFees: real('selling_fees').default(0),
  shippingCost: real('shipping_cost').default(0),

  totalCost: real('total_cost'),
  profit: real('profit'),
  roiPercentage: real('roi_percentage'),

  notes: text('notes'),
  listingText: text('listing_text'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('idx_projects_status').on(table.status),
  index('idx_projects_listing_id').on(table.listingId),
]);

// ============================================================
// Background Jobs
// ============================================================

export const backgroundJobs = pgTable('background_jobs', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['scrape', 'analyze'] }).notNull(),
  status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull().default('running'),
  result: text('result'),
  error: text('error'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('idx_background_jobs_status').on(table.status),
]);

// ============================================================
// Agent Pipeline
// ============================================================

export const agentRuns = pgTable('agent_runs', {
  id: serial('id').primaryKey(),
  runId: text('run_id').notNull().unique(),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull().default('running'),
  scraped: integer('scraped').default(0),
  triaged: integer('triaged').default(0),
  passedTriage: integer('passed_triage').default(0),
  evaluated: integer('evaluated').default(0),
  qualified: integer('qualified').default(0),
  rendered: integer('rendered').default(0),
  errorsCount: integer('errors_count').default(0),
  errorDetails: text('error_details'),
  config: text('config'),
});

export const conceptRenders = pgTable('concept_renders', {
  id: serial('id').primaryKey(),
  listingId: integer('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  agentRunId: text('agent_run_id'),
  difficulty: text('difficulty', { enum: ['simple', 'moderate', 'full'] }).notNull(),
  label: text('label').notNull(),
  summary: text('summary').notNull(),
  estimatedHours: real('estimated_hours'),
  estimatedMaterialCost: real('estimated_material_cost'),
  estimatedResalePrice: real('estimated_resale_price'),
  prompt: text('prompt').notNull(),
  renderedImageUrl: text('rendered_image_url'),
  localPath: text('local_path'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('idx_concept_renders_listing_id').on(table.listingId),
]);

// ============================================================
// App Settings (admin-editable, runtime config)
// ============================================================

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ============================================================
// Regions (multi-region agent scraping)
// ============================================================

export const regions = pgTable('regions', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  radiusMiles: integer('radius_miles').notNull().default(30),
  clSubdomain: text('cl_subdomain'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ============================================================
// Knowledge Sources (DB-backed RAG source registry)
// ============================================================

export const knowledgeSources = pgTable('knowledge_sources', {
  id: serial('id').primaryKey(),
  type: text('type', { enum: ['product', 'guide'] }).notNull(),
  url: text('url').notNull().unique(),
  title: text('title').notNull(),
  metadata: text('metadata').notNull().default('{}'),
  autoDiscovered: boolean('auto_discovered').notNull().default(false),
  lastIngestedAt: timestamp('last_ingested_at'),
  contentHash: text('content_hash'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const projectPhotos = pgTable('project_photos', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  photoType: text('photo_type', { enum: ['before', 'during', 'after'] }).notNull(),
  localPath: text('local_path').notNull(),
  caption: text('caption'),
  takenAt: timestamp('taken_at').notNull().defaultNow(),
}, (table) => [
  index('idx_project_photos_project_id').on(table.projectId),
]);
