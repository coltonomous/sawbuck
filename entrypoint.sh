#!/bin/sh
set -e

# Ensure data directories exist and are writable by the app user.
# Bind-mounted host directories may be root-owned, so fix ownership.
mkdir -p /app/data/images/originals /app/data/images/resized
chown -R app:app /app/data

# Run migrations and start server as the unprivileged app user
exec su -s /bin/sh app -c "npx drizzle-kit migrate && npx tsx server/db/seed-admin.ts && NODE_ENV=production npx tsx server/index.ts"
