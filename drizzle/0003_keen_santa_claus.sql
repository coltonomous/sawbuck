CREATE TABLE `background_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`result` text,
	`error` text,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_background_jobs_status` ON `background_jobs` (`status`);--> statement-breakpoint
ALTER TABLE `listings` ADD `analysis_error` text;