PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_comparables` (
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
	`user_id` text,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_comparables`("id", "listing_id", "source", "source_url", "title", "sold_price", "sold_date", "condition", "furniture_type", "furniture_style", "search_query", "created_at", "user_id") SELECT "id", "listing_id", "source", "source_url", "title", "sold_price", "sold_date", "condition", "furniture_type", "furniture_style", "search_query", "created_at", "user_id" FROM `comparables`;--> statement-breakpoint
DROP TABLE `comparables`;--> statement-breakpoint
ALTER TABLE `__new_comparables` RENAME TO `comparables`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_comparables_listing_id` ON `comparables` (`listing_id`);--> statement-breakpoint
CREATE INDEX `idx_comparables_furniture_type` ON `comparables` (`furniture_type`);--> statement-breakpoint
CREATE TABLE `__new_projects` (
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
	`listing_text` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`user_id` text,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "listing_id", "name", "status", "purchase_price", "purchase_date", "purchase_notes", "total_material_cost", "hours_invested", "hourly_rate", "listed_price", "listed_date", "listed_platform", "sold_price", "sold_date", "selling_fees", "shipping_cost", "total_cost", "profit", "roi_percentage", "notes", "listing_text", "created_at", "updated_at", "user_id") SELECT "id", "listing_id", "name", "status", "purchase_price", "purchase_date", "purchase_notes", "total_material_cost", "hours_invested", "hourly_rate", "listed_price", "listed_date", "listed_platform", "sold_price", "sold_date", "selling_fees", "shipping_cost", "total_cost", "profit", "roi_percentage", "notes", "listing_text", "created_at", "updated_at", "user_id" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
CREATE INDEX `idx_projects_status` ON `projects` (`status`);--> statement-breakpoint
CREATE INDEX `idx_projects_listing_id` ON `projects` (`listing_id`);--> statement-breakpoint
CREATE TABLE `__new_refinishing_plans` (
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
	`rag_sources_used` integer DEFAULT 0,
	`rag_source_titles` text,
	`rag_sources` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`user_id` text,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_refinishing_plans`("id", "listing_id", "project_id", "style_recommendation", "description", "steps", "estimated_hours", "estimated_material_cost", "estimated_resale_price", "difficulty_level", "before_description", "after_description", "raw_response", "rag_sources_used", "rag_source_titles", "rag_sources", "created_at", "user_id") SELECT "id", "listing_id", "project_id", "style_recommendation", "description", "steps", "estimated_hours", "estimated_material_cost", "estimated_resale_price", "difficulty_level", "before_description", "after_description", "raw_response", "rag_sources_used", "rag_source_titles", "rag_sources", "created_at", "user_id" FROM `refinishing_plans`;--> statement-breakpoint
DROP TABLE `refinishing_plans`;--> statement-breakpoint
ALTER TABLE `__new_refinishing_plans` RENAME TO `refinishing_plans`;--> statement-breakpoint
CREATE INDEX `idx_refinishing_plans_listing_id` ON `refinishing_plans` (`listing_id`);