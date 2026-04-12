CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"status" text DEFAULT 'running' NOT NULL,
	"scraped" integer DEFAULT 0,
	"triaged" integer DEFAULT 0,
	"passed_triage" integer DEFAULT 0,
	"evaluated" integer DEFAULT 0,
	"qualified" integer DEFAULT 0,
	"rendered" integer DEFAULT 0,
	"errors_count" integer DEFAULT 0,
	"error_details" text,
	"config" text,
	CONSTRAINT "agent_runs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"result" text,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "comparables" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer,
	"source" text DEFAULT 'ebay' NOT NULL,
	"source_url" text,
	"title" text NOT NULL,
	"sold_price" real NOT NULL,
	"sold_date" timestamp,
	"condition" text,
	"furniture_type" text,
	"furniture_style" text,
	"search_query" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "concept_renders" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"agent_run_id" text,
	"difficulty" text NOT NULL,
	"label" text NOT NULL,
	"summary" text NOT NULL,
	"estimated_hours" real,
	"estimated_material_cost" real,
	"estimated_resale_price" real,
	"prompt" text NOT NULL,
	"rendered_image_url" text,
	"local_path" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"source_url" text NOT NULL,
	"local_path_original" text,
	"local_path_resized" text,
	"width" integer,
	"height" integer,
	"file_size_bytes" integer,
	"download_status" text DEFAULT 'pending' NOT NULL,
	"analysis_status" text DEFAULT 'pending' NOT NULL,
	"analysis_result" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"platform" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"asking_price" real,
	"location" text,
	"latitude" real,
	"longitude" real,
	"seller_name" text,
	"posted_at" timestamp,
	"scraped_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"furniture_type" text,
	"furniture_style" text,
	"condition_score" real,
	"condition_notes" text,
	"wood_species" text,
	"wood_confidence" real,
	"analysis_raw" text,
	"analyzed_at" timestamp,
	"estimated_value" real,
	"estimated_refinished_value" real,
	"deal_score" real,
	"matched_search_terms" text,
	"fingerprint" text,
	"analysis_error" text,
	"triage_source" text,
	"agent_run_id" text,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" serial PRIMARY KEY NOT NULL,
	"refinishing_plan_id" integer NOT NULL,
	"project_id" integer,
	"category" text NOT NULL,
	"product_name" text NOT NULL,
	"brand" text,
	"quantity" real DEFAULT 1 NOT NULL,
	"unit" text,
	"estimated_price" real,
	"actual_price" real,
	"purchased" boolean DEFAULT false NOT NULL,
	"amazon_search_url" text,
	"home_depot_search_url" text,
	"lowes_search_url" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"platform" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"photo_type" text NOT NULL,
	"local_path" text NOT NULL,
	"caption" text,
	"taken_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'acquired' NOT NULL,
	"purchase_price" real NOT NULL,
	"purchase_date" timestamp,
	"purchase_notes" text,
	"total_material_cost" real DEFAULT 0,
	"hours_invested" real DEFAULT 0,
	"hourly_rate" real DEFAULT 25,
	"listed_price" real,
	"listed_date" timestamp,
	"listed_platform" text,
	"sold_price" real,
	"sold_date" timestamp,
	"selling_fees" real DEFAULT 0,
	"shipping_cost" real DEFAULT 0,
	"total_cost" real,
	"profit" real,
	"roi_percentage" real,
	"notes" text,
	"listing_text" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "refinishing_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"project_id" integer,
	"style_recommendation" text,
	"description" text,
	"steps" text NOT NULL,
	"estimated_hours" real,
	"estimated_material_cost" real,
	"estimated_resale_price" real,
	"difficulty_level" text,
	"before_description" text,
	"after_description" text,
	"raw_response" text,
	"rag_sources_used" integer DEFAULT 0,
	"rag_source_titles" text,
	"rag_sources" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"search_config_id" integer,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"listings_found" integer DEFAULT 0,
	"listings_new" integer DEFAULT 0,
	"listings_duplicate" integer DEFAULT 0,
	"error" text,
	"status" text DEFAULT 'running' NOT NULL,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "search_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"search_term" text NOT NULL,
	"category" text,
	"location" text,
	"min_price" real,
	"max_price" real,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"preferred_latitude" real,
	"preferred_longitude" real,
	"preferred_radius_miles" integer DEFAULT 25,
	"max_budget" real,
	"shop_space" text,
	"experience_level" text,
	"style_preferences" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparables" ADD CONSTRAINT "comparables_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparables" ADD CONSTRAINT "comparables_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_renders" ADD CONSTRAINT "concept_renders_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_refinishing_plan_id_refinishing_plans_id_fk" FOREIGN KEY ("refinishing_plan_id") REFERENCES "public"."refinishing_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_photos" ADD CONSTRAINT "project_photos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refinishing_plans" ADD CONSTRAINT "refinishing_plans_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refinishing_plans" ADD CONSTRAINT "refinishing_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refinishing_plans" ADD CONSTRAINT "refinishing_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_search_config_id_search_configs_id_fk" FOREIGN KEY ("search_config_id") REFERENCES "public"."search_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_configs" ADD CONSTRAINT "search_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_background_jobs_status" ON "background_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_comparables_listing_id" ON "comparables" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "idx_comparables_furniture_type" ON "comparables" USING btree ("furniture_type");--> statement-breakpoint
CREATE INDEX "idx_concept_renders_listing_id" ON "concept_renders" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "idx_listing_images_listing_id" ON "listing_images" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "idx_listing_images_download_status" ON "listing_images" USING btree ("download_status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_listings_platform_external" ON "listings" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "idx_listings_status" ON "listings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_listings_deal_score" ON "listings" USING btree ("deal_score");--> statement-breakpoint
CREATE INDEX "idx_listings_platform" ON "listings" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "idx_listings_furniture_type" ON "listings" USING btree ("furniture_type");--> statement-breakpoint
CREATE INDEX "idx_listings_scraped_at" ON "listings" USING btree ("scraped_at");--> statement-breakpoint
CREATE INDEX "idx_listings_fingerprint" ON "listings" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "idx_listings_user_id" ON "listings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_materials_plan_id" ON "materials" USING btree ("refinishing_plan_id");--> statement-breakpoint
CREATE INDEX "idx_materials_project_id" ON "materials" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_project_photos_project_id" ON "project_photos" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_projects_status" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_projects_listing_id" ON "projects" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "idx_refinishing_plans_listing_id" ON "refinishing_plans" USING btree ("listing_id");