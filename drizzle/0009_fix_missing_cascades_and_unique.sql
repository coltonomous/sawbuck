-- Fix missing UNIQUE constraint on users.email
-- Deployed DBs created before this constraint was added need it.
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique` ON `users` (`email`);
