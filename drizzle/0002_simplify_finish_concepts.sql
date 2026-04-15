-- Replace difficulty enum with finish_type text column on concept_renders
-- and drop the per-concept estimate columns (estimates now live on the single plan)
ALTER TABLE "concept_renders" RENAME COLUMN "difficulty" TO "finish_type";--> statement-breakpoint
ALTER TABLE "concept_renders" DROP COLUMN IF EXISTS "estimated_hours";--> statement-breakpoint
ALTER TABLE "concept_renders" DROP COLUMN IF EXISTS "estimated_material_cost";--> statement-breakpoint
ALTER TABLE "concept_renders" DROP COLUMN IF EXISTS "estimated_resale_price";
