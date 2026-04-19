#!/bin/sh
set -e

# Ensure data directory exists and is writable by the app user.
mkdir -p /app/data
chown -R app:app /app/data

# Run pre-push migrations (CREATE IF NOT EXISTS — safe to re-run) to avoid
# drizzle-kit interactive prompts when it sees new tables it can't auto-resolve.
echo "Running pre-push migrations..."
su -s /bin/sh app -c 'node -e "
  const { Pool } = require(\"pg\");
  const fs = require(\"fs\");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = fs.readFileSync(\"/app/scripts/migrate-new-tables.sql\", \"utf-8\");
  pool.query(sql)
    .then(() => { console.log(\"Pre-push migrations applied\"); return pool.end(); })
    .catch(e => { console.warn(\"Pre-push migration warning:\", e.message); return pool.end(); });
"'

# Apply numbered migrations from drizzle/ (the source of truth for schema
# changes that need ordered, hand-written SQL — e.g. backfills). Then
# drizzle-kit push --force as a safety net catches any schema drift between
# the live DB and the schema.ts definitions.
echo "Applying drizzle migrations..."
su -s /bin/sh app -c "npx tsx scripts/migrate.ts"

exec su -s /bin/sh app -c "npx drizzle-kit push --force && NODE_ENV=production npx tsx server/index.ts"
