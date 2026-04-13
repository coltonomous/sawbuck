#!/bin/sh
set -e

# Ensure data directories exist and are writable by the app user.
mkdir -p /app/data/images/originals /app/data/images/resized /app/data/images/concepts
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

# Push schema to Postgres and start server as the unprivileged app user
exec su -s /bin/sh app -c "npx drizzle-kit push --force && NODE_ENV=production npx tsx server/index.ts"
