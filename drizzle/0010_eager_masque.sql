CREATE TABLE `agent_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`scraped` integer DEFAULT 0,
	`triaged` integer DEFAULT 0,
	`passed_triage` integer DEFAULT 0,
	`evaluated` integer DEFAULT 0,
	`qualified` integer DEFAULT 0,
	`rendered` integer DEFAULT 0,
	`errors_count` integer DEFAULT 0,
	`error_details` text,
	`config` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_run_id_unique` ON `agent_runs` (`run_id`);--> statement-breakpoint
CREATE TABLE `concept_renders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` integer NOT NULL,
	`agent_run_id` text,
	`prompt` text NOT NULL,
	`rendered_image_url` text,
	`local_path` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_concept_renders_listing_id` ON `concept_renders` (`listing_id`);--> statement-breakpoint
ALTER TABLE `listings` ADD `triage_source` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `agent_run_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `preferred_latitude` real;--> statement-breakpoint
ALTER TABLE `users` ADD `preferred_longitude` real;--> statement-breakpoint
ALTER TABLE `users` ADD `preferred_radius_miles` integer DEFAULT 25;--> statement-breakpoint
ALTER TABLE `users` ADD `max_budget` real;--> statement-breakpoint
ALTER TABLE `users` ADD `shop_space` text;--> statement-breakpoint
ALTER TABLE `users` ADD `experience_level` text;--> statement-breakpoint
ALTER TABLE `users` ADD `style_preferences` text;