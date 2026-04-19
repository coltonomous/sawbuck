# Drizzle migrations

All schema changes go through hand-written SQL files in this folder, applied
by `scripts/migrate.ts` on every deploy. Do **not** rely on `drizzle-kit push`
to mutate schema in production — push is only used at container start as a
belt-and-suspenders no-op against the already-migrated DB.

## Adding a migration

1. Edit `server/db/schema.ts` with the new shape.
2. Create `drizzle/NNNN_short_name.sql` — use `--> statement-breakpoint` between
   statements so drizzle-kit migrate runs each in its own transaction step.
3. Add a matching entry to `drizzle/meta/_journal.json` (copy the shape of the
   previous entry, bump `idx` and `when`).
4. Run `npm run db:migrate` locally against a dev DB to confirm the migration
   succeeds, then run the test suite.

## Rollback story

**The migrator is forward-only.** There are no `down` migrations. If a deploy
fails mid-migration, recovery is:

1. **Immediate**: roll the EC2 container back to the previous image tag
   (`docker compose` step in `deploy.yml` rebuilds every time, so
   `docker image ls` on the host retains the prior image for a short window).
   The previous app version tolerates the partially-migrated schema for
   additive-only migrations.
2. **If the migration is destructive** (drops a column, changes a type, tightens
   a constraint), restore from the nightly S3 backup (`BACKUP_S3_BUCKET`) and
   re-deploy the prior image.

## Forward-compatible migration pattern

When a migration tightens a constraint (adds NOT NULL, adds a unique index,
drops a column the old app still reads), split it across **two deploys** so
you never run an app version that mismatches the schema it sees:

- Deploy N: add nullable column + backfill + deploy code that writes to the new
  column but still reads old columns.
- Deploy N+1: add NOT NULL / unique constraint; drop old columns; deploy code
  that reads from the new column exclusively.

Migration `0004_concept_renders_concept_index` was **not** split this way —
it ran in a single deploy. That worked because the table had fewer than ~100
rows in production at the time and the backfill completed in milliseconds.
For any table with meaningful row counts, prefer the two-deploy pattern.

## Historical context

Migrations `0000`-`0003` were authored before `scripts/migrate.ts` existed.
Those DBs were bootstrapped via `drizzle-kit push --force`, so the
migrator seeds `drizzle.__drizzle_migrations` with their sha256 hashes on
first run to prevent duplicate application. See `HISTORICAL_TAGS` in
`scripts/migrate.ts`.
