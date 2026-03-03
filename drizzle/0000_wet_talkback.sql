CREATE TABLE `comparables` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` integer,
	`source` text DEFAULT 'ebay' NOT NULL,
	`source_url` text,
	`title` text NOT NULL,
	`sold_price` real NOT NULL,
	`sold_date` text,
	`condition` text,
	`furniture_type` text,
	`furniture_style` text,
	`search_query` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_comparables_listing_id` ON `comparables` (`listing_id`);--> statement-breakpoint
CREATE INDEX `idx_comparables_furniture_type` ON `comparables` (`furniture_type`);--> statement-breakpoint
CREATE TABLE `listing_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` integer NOT NULL,
	`source_url` text NOT NULL,
	`local_path_original` text,
	`local_path_resized` text,
	`width` integer,
	`height` integer,
	`file_size_bytes` integer,
	`download_status` text DEFAULT 'pending' NOT NULL,
	`analysis_status` text DEFAULT 'pending' NOT NULL,
	`analysis_result` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_listing_images_listing_id` ON `listing_images` (`listing_id`);--> statement-breakpoint
CREATE INDEX `idx_listing_images_download_status` ON `listing_images` (`download_status`);--> statement-breakpoint
CREATE TABLE `listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`external_id` text NOT NULL,
	`platform` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`asking_price` real,
	`location` text,
	`latitude` real,
	`longitude` real,
	`seller_name` text,
	`posted_at` text,
	`scraped_at` text DEFAULT (datetime('now')) NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`furniture_type` text,
	`furniture_style` text,
	`condition_score` real,
	`condition_notes` text,
	`wood_species` text,
	`wood_confidence` real,
	`analysis_raw` text,
	`analyzed_at` text,
	`estimated_value` real,
	`estimated_refinished_value` real,
	`deal_score` real,
	`fingerprint` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_listings_platform_external` ON `listings` (`platform`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_listings_status` ON `listings` (`status`);--> statement-breakpoint
CREATE INDEX `idx_listings_deal_score` ON `listings` (`deal_score`);--> statement-breakpoint
CREATE INDEX `idx_listings_platform` ON `listings` (`platform`);--> statement-breakpoint
CREATE INDEX `idx_listings_furniture_type` ON `listings` (`furniture_type`);--> statement-breakpoint
CREATE INDEX `idx_listings_scraped_at` ON `listings` (`scraped_at`);--> statement-breakpoint
CREATE INDEX `idx_listings_fingerprint` ON `listings` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`refinishing_plan_id` integer NOT NULL,
	`project_id` integer,
	`category` text NOT NULL,
	`product_name` text NOT NULL,
	`brand` text,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit` text,
	`estimated_price` real,
	`actual_price` real,
	`purchased` integer DEFAULT false NOT NULL,
	`amazon_search_url` text,
	`home_depot_search_url` text,
	`lowes_search_url` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`refinishing_plan_id`) REFERENCES `refinishing_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_materials_plan_id` ON `materials` (`refinishing_plan_id`);--> statement-breakpoint
CREATE INDEX `idx_materials_project_id` ON `materials` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`photo_type` text NOT NULL,
	`local_path` text NOT NULL,
	`caption` text,
	`taken_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_photos_project_id` ON `project_photos` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` integer NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'acquired' NOT NULL,
	`purchase_price` real NOT NULL,
	`purchase_date` text,
	`purchase_notes` text,
	`total_material_cost` real DEFAULT 0,
	`hours_invested` real DEFAULT 0,
	`hourly_rate` real DEFAULT 25,
	`listed_price` real,
	`listed_date` text,
	`listed_platform` text,
	`sold_price` real,
	`sold_date` text,
	`selling_fees` real DEFAULT 0,
	`shipping_cost` real DEFAULT 0,
	`total_cost` real,
	`profit` real,
	`roi_percentage` real,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_projects_status` ON `projects` (`status`);--> statement-breakpoint
CREATE INDEX `idx_projects_listing_id` ON `projects` (`listing_id`);--> statement-breakpoint
CREATE TABLE `refinishing_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` integer NOT NULL,
	`project_id` integer,
	`style_recommendation` text,
	`description` text,
	`steps` text NOT NULL,
	`estimated_hours` real,
	`estimated_material_cost` real,
	`estimated_resale_price` real,
	`difficulty_level` text,
	`before_description` text,
	`after_description` text,
	`raw_response` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_refinishing_plans_listing_id` ON `refinishing_plans` (`listing_id`);--> statement-breakpoint
CREATE TABLE `scrape_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`search_config_id` integer,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text,
	`listings_found` integer DEFAULT 0,
	`listings_new` integer DEFAULT 0,
	`listings_duplicate` integer DEFAULT 0,
	`error` text,
	`status` text DEFAULT 'running' NOT NULL,
	FOREIGN KEY (`search_config_id`) REFERENCES `search_configs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `search_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`search_term` text NOT NULL,
	`category` text,
	`location` text,
	`min_price` real,
	`max_price` real,
	`is_active` integer DEFAULT true NOT NULL,
	`last_run_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
