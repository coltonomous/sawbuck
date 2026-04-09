-- Fix missing UNIQUE constraint on users.email
-- First deduplicate: keep the oldest user per email, delete newer duplicates
DELETE FROM sessions WHERE user_id IN (
  SELECT u.id FROM users u
  WHERE u.rowid NOT IN (SELECT MIN(rowid) FROM users GROUP BY email)
);--> statement-breakpoint
DELETE FROM accounts WHERE user_id IN (
  SELECT u.id FROM users u
  WHERE u.rowid NOT IN (SELECT MIN(rowid) FROM users GROUP BY email)
);--> statement-breakpoint
DELETE FROM claude_usage WHERE user_id IN (
  SELECT u.id FROM users u
  WHERE u.rowid NOT IN (SELECT MIN(rowid) FROM users GROUP BY email)
);--> statement-breakpoint
DELETE FROM background_jobs WHERE user_id IN (
  SELECT u.id FROM users u
  WHERE u.rowid NOT IN (SELECT MIN(rowid) FROM users GROUP BY email)
);--> statement-breakpoint
DELETE FROM scrape_runs WHERE user_id IN (
  SELECT u.id FROM users u
  WHERE u.rowid NOT IN (SELECT MIN(rowid) FROM users GROUP BY email)
);--> statement-breakpoint
DELETE FROM search_configs WHERE user_id IN (
  SELECT u.id FROM users u
  WHERE u.rowid NOT IN (SELECT MIN(rowid) FROM users GROUP BY email)
);--> statement-breakpoint
DELETE FROM materials WHERE refinishing_plan_id IN (
  SELECT rp.id FROM refinishing_plans rp
  JOIN listings l ON rp.listing_id = l.id
  JOIN users u ON l.user_id = u.id
  WHERE u.rowid NOT IN (SELECT MIN(rowid) FROM users GROUP BY email)
);--> statement-breakpoint
DELETE FROM listing_images WHERE listing_id IN (
  SELECT l.id FROM listings l
  JOIN users u ON l.user_id = u.id
  WHERE u.rowid NOT IN (SELECT MIN(rowid) FROM users GROUP BY email)
);--> statement-breakpoint
DELETE FROM project_photos WHERE project_id IN (
  SELECT p.id FROM projects p
  JOIN users u ON p.user_id = u.id
  WHERE u.rowid NOT IN (SELECT MIN(rowid) FROM users GROUP BY email)
);--> statement-breakpoint
DELETE FROM refinishing_plans WHERE listing_id IN (
  SELECT l.id FROM listings l
  JOIN users u ON l.user_id = u.id
  WHERE u.rowid NOT IN (SELECT MIN(rowid) FROM users GROUP BY email)
);--> statement-breakpoint
DELETE FROM comparables WHERE listing_id IN (
  SELECT l.id FROM listings l
  JOIN users u ON l.user_id = u.id
  WHERE u.rowid NOT IN (SELECT MIN(rowid) FROM users GROUP BY email)
);--> statement-breakpoint
DELETE FROM projects WHERE user_id IN (
  SELECT u.id FROM users u
  WHERE u.rowid NOT IN (SELECT MIN(rowid) FROM users GROUP BY email)
);--> statement-breakpoint
DELETE FROM listings WHERE user_id IN (
  SELECT u.id FROM users u
  WHERE u.rowid NOT IN (SELECT MIN(rowid) FROM users GROUP BY email)
);--> statement-breakpoint
DELETE FROM users WHERE rowid NOT IN (SELECT MIN(rowid) FROM users GROUP BY email);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique` ON `users` (`email`);
