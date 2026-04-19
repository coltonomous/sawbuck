-- Replace the (listing_id, finish_type) uniqueness with (listing_id, concept_index).
-- The LLM frequently produces two concepts that share a finish_type (e.g. two
-- "stain" variants for one listing); under the old constraint the second
-- insert was silently dropped by ON CONFLICT DO NOTHING, leaving 2 renders
-- instead of 3. The concept_index identifies a render by its slot (0..N-1)
-- so duplicate finish_types coexist.
ALTER TABLE "concept_renders" ADD COLUMN "concept_index" integer;--> statement-breakpoint

-- Backfill existing rows: assign 0..N-1 per listing, ordered by id.
UPDATE "concept_renders" SET "concept_index" = sub.idx FROM (
  SELECT id, (ROW_NUMBER() OVER (PARTITION BY listing_id ORDER BY id) - 1) AS idx
  FROM "concept_renders"
) sub
WHERE "concept_renders".id = sub.id;--> statement-breakpoint

ALTER TABLE "concept_renders" ALTER COLUMN "concept_index" SET NOT NULL;--> statement-breakpoint

DROP INDEX IF EXISTS "idx_concept_renders_listing_finish";--> statement-breakpoint

CREATE UNIQUE INDEX "idx_concept_renders_listing_index" ON "concept_renders" USING btree ("listing_id","concept_index");
