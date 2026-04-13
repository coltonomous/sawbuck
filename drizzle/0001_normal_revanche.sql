CREATE UNIQUE INDEX "idx_accounts_provider_account" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "idx_listings_user_platform" ON "listings" USING btree ("user_id","platform");--> statement-breakpoint
CREATE INDEX "idx_listings_status_deal_score" ON "listings" USING btree ("status","deal_score");