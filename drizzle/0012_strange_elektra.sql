ALTER TABLE `concept_renders` ADD `difficulty` text NOT NULL;--> statement-breakpoint
ALTER TABLE `concept_renders` ADD `label` text NOT NULL;--> statement-breakpoint
ALTER TABLE `concept_renders` ADD `summary` text NOT NULL;--> statement-breakpoint
ALTER TABLE `concept_renders` ADD `estimated_hours` real;--> statement-breakpoint
ALTER TABLE `concept_renders` ADD `estimated_material_cost` real;--> statement-breakpoint
ALTER TABLE `concept_renders` ADD `estimated_resale_price` real;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `daily_claude_limit`;