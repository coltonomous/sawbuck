#!/bin/sh
set -e

# Ensure data directories exist and are writable by the app user.
mkdir -p /app/data/images/originals /app/data/images/resized /app/data/images/concepts
chown -R app:app /app/data

# Push schema to Postgres and start server as the unprivileged app user
exec su -s /bin/sh app -c "npx drizzle-kit push --force && NODE_ENV=production npx tsx server/index.ts"
