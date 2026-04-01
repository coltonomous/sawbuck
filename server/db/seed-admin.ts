import { sqlite } from './index.js';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

if (!ADMIN_EMAIL) {
  console.log('[seed-admin] ADMIN_EMAIL not set, skipping admin seed');
  process.exit(0);
}

const ADMIN_ID = 'admin-seed';
const now = Math.floor(Date.now() / 1000);

// Upsert admin user
const existing = sqlite.prepare('SELECT id, role FROM users WHERE email = ?').get(ADMIN_EMAIL) as { id: string; role: string } | undefined;

if (!existing) {
  sqlite.prepare(`
    INSERT INTO users (id, name, email, email_verified, role, daily_claude_limit, created_at, updated_at)
    VALUES (?, ?, ?, 1, 'admin', 999999, ?, ?)
  `).run(ADMIN_ID, 'Admin', ADMIN_EMAIL, now, now);
  console.log(`[seed-admin] Created admin user: ${ADMIN_EMAIL}`);
} else if (existing.role !== 'admin') {
  sqlite.prepare('UPDATE users SET role = ?, daily_claude_limit = 999999, updated_at = ? WHERE id = ?')
    .run('admin', now, existing.id);
  console.log(`[seed-admin] Promoted ${ADMIN_EMAIL} to admin`);
} else {
  console.log(`[seed-admin] Admin user already exists: ${ADMIN_EMAIL}`);
}

// Backfill existing rows with NULL userId to admin
const adminId = existing?.id ?? ADMIN_ID;
const tables = ['listings', 'search_configs', 'projects', 'comparables', 'refinishing_plans', 'background_jobs', 'scrape_runs'];

for (const table of tables) {
  const result = sqlite.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(adminId);
  if (result.changes > 0) {
    console.log(`[seed-admin] Backfilled ${result.changes} rows in ${table}`);
  }
}

console.log('[seed-admin] Done');
