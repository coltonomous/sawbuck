import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Migrations 0000–0003 were already applied to existing DBs via drizzle-kit push
// before the migrator was wired into the deploy. On the first migrator run
// against such a DB we seed __drizzle_migrations with their journal timestamps
// so migrate() doesn't re-run their CREATE TABLE statements.
export const HISTORICAL_TAGS = new Set([
  '0000_pale_vertigo',
  '0001_normal_revanche',
  '0002_simplify_finish_concepts',
  '0003_concept_renders_unique_finish',
]);

const MIGRATIONS_FOLDER = path.resolve('./drizzle');

// Minimal query interface so tests can pass a stub.
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export async function seedHistoricalIfNeeded(
  pool: Queryable,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<void> {
  const { rows: tableCheck } = await pool.query(
    `SELECT to_regclass('public.listings') AS t`,
  );
  if (!tableCheck[0]?.t) return;

  await pool.query('CREATE SCHEMA IF NOT EXISTS drizzle');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const { rows: countRows } = await pool.query(
    'SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations',
  );
  if (countRows[0].c > 0) return;

  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  for (const entry of journal.entries) {
    if (!HISTORICAL_TAGS.has(entry.tag)) continue;
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const hash = crypto.createHash('sha256').update(sql).digest('hex');
    await pool.query(
      'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
      [hash, entry.when],
    );
    console.log(`Seeded historical migration ${entry.tag} (when=${entry.when})`);
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required to apply migrations');

  const pool = new Pool({ connectionString: url });
  try {
    await seedHistoricalIfNeeded(pool);
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('Migrations applied');
  } finally {
    await pool.end();
  }
}

// Only run as a script when invoked directly (not when imported by tests).
const invokedAsScript = import.meta.url === `file://${process.argv[1]}`;
if (invokedAsScript) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
