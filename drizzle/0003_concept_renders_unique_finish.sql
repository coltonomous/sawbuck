-- Add unique constraint on (listing_id, finish_type) so that
-- ON CONFLICT DO NOTHING correctly deduplicates concept renders per listing.
-- Without this index the onConflictDoNothing() clause had no constraint to
-- match against and the insert would either fail or silently create duplicates.
CREATE UNIQUE INDEX "idx_concept_renders_listing_finish" ON "concept_renders" USING btree ("listing_id","finish_type");
