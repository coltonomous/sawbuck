CREATE TABLE IF NOT EXISTS `platform_settings` (
	`platform` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL
);
