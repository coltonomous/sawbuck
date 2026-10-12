#!/bin/sh
set -e

# Ensure data directory exists and is writable by the app user.
mkdir -p /app/data
chown -R app:app /app/data

# Run legacy pre-migrator SQL (CREATE IF NOT EXISTS — safe to re-run).
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

# Apply numbered migrations from drizzle/ — the only thing that changes schema
# at boot. No `drizzle-kit push --force` here: it drops every table not in
# schema.ts, which includes the runtime-managed knowledge_chunks (RAG) and
# LangGraph checkpoint tables, wiping them on every container start.
echo "Applying drizzle migrations..."
su -s /bin/sh app -c "npx tsx scripts/migrate.ts"

exec su -s /bin/sh app -c "NODE_ENV=production npx tsx server/index.ts"
