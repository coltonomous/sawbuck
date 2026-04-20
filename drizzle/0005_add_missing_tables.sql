-- Tables added to schema.ts after migrations 0000-0003 were authored but
-- before the drizzle-orm migrator was wired into deploy. On production
-- these were created by the historical drizzle-kit push bootstrap, so
-- CREATE TABLE IF NOT EXISTS keeps this migration a no-op there. On CI
-- and fresh dev DBs that only run the migrator, it closes the gap so the
-- app can query listing_clicks / user_dismissals / regions / knowledge_sources.
CREATE TABLE IF NOT EXISTS "listing_clicks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"listing_id" integer NOT NULL REFERENCES "listings"("id") ON DELETE cascade,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_dismissals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"listing_id" integer NOT NULL REFERENCES "listings"("id") ON DELETE cascade,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_dismissals_unique" ON "user_dismissals" USING btree ("user_id","listing_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"radius_miles" integer DEFAULT 30 NOT NULL,
	"cl_subdomain" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "regions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"metadata" text DEFAULT '{}' NOT NULL,
	"auto_discovered" boolean DEFAULT false NOT NULL,
	"last_ingested_at" timestamp,
	"last_failed_at" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"content_hash" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_sources_url_unique" UNIQUE("url")
);
