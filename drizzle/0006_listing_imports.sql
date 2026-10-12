-- Per-user access to a listing someone else owns. Listings are unique per
-- (platform, external_id), so a second user importing the same URL gets a row
-- here instead of the import route nulling out the owner (which pushed the
-- listing into every user's feed).
CREATE TABLE IF NOT EXISTS "listing_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"listing_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "listing_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "listing_imports_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_listing_imports_unique" ON "listing_imports" USING btree ("user_id","listing_id");
