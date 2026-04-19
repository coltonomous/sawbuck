import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { seedHistoricalIfNeeded, HISTORICAL_TAGS, type Queryable } from '../migrate.js';

// A fake in-memory query executor that records every call and responds based
// on simple pattern matching. It only understands the handful of queries the
// seed function actually issues.
function makeFakePool(opts: {
  listingsTableExists: boolean;
  migrationsRowCount: number;
}) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const inserted: { hash: string; createdAt: number }[] = [];

  const query = async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    const trimmed = sql.trim();

    if (trimmed.startsWith("SELECT to_regclass")) {
      return { rows: [{ t: opts.listingsTableExists ? 'listings' : null }] };
    }
    if (trimmed.startsWith('CREATE SCHEMA')) return { rows: [] };
    if (trimmed.startsWith('CREATE TABLE')) return { rows: [] };
    if (trimmed.startsWith('SELECT count(*)')) {
      return { rows: [{ c: opts.migrationsRowCount }] };
    }
    if (trimmed.startsWith('INSERT INTO drizzle.__drizzle_migrations')) {
      const [hash, createdAt] = params as [string, number];
      inserted.push({ hash, createdAt });
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL in fake pool: ${sql}`);
  };

  const pool: Queryable = { query };
  return { pool, calls, inserted };
}

const realMigrationsFolder = path.resolve('./drizzle');

function readJournalEntry(tag: string): { when: number } {
  const journal = JSON.parse(
    fs.readFileSync(path.join(realMigrationsFolder, 'meta', '_journal.json'), 'utf8'),
  );
  const entry = journal.entries.find((e: any) => e.tag === tag);
  if (!entry) throw new Error(`Journal missing entry for ${tag}`);
  return entry;
}

function sha256OfFile(tag: string): string {
  const sql = fs.readFileSync(path.join(realMigrationsFolder, `${tag}.sql`), 'utf8');
  return crypto.createHash('sha256').update(sql).digest('hex');
}

describe('seedHistoricalIfNeeded', () => {
  let fake: ReturnType<typeof makeFakePool>;

  describe('when listings table does not exist (fresh DB)', () => {
    beforeEach(() => {
      fake = makeFakePool({ listingsTableExists: false, migrationsRowCount: 0 });
    });

    it('does nothing — leaves seeding to drizzle-kit migrate', async () => {
      await seedHistoricalIfNeeded(fake.pool);

      expect(fake.inserted).toHaveLength(0);
      // Only the to_regclass check should have run.
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0].sql).toContain('to_regclass');
    });
  });

  describe('when listings exists and __drizzle_migrations already has rows', () => {
    beforeEach(() => {
      fake = makeFakePool({ listingsTableExists: true, migrationsRowCount: 5 });
    });

    it('is a no-op — does not re-seed historical rows', async () => {
      await seedHistoricalIfNeeded(fake.pool);
      expect(fake.inserted).toHaveLength(0);
    });

    it('still ensures drizzle schema/table exist (idempotent bootstrap)', async () => {
      await seedHistoricalIfNeeded(fake.pool);
      const sqls = fake.calls.map((c) => c.sql.trim());
      expect(sqls.some((s) => s.startsWith('CREATE SCHEMA'))).toBe(true);
      expect(sqls.some((s) => s.startsWith('CREATE TABLE'))).toBe(true);
    });
  });

  describe('when listings exists and __drizzle_migrations is empty (pre-migrator DB)', () => {
    beforeEach(() => {
      fake = makeFakePool({ listingsTableExists: true, migrationsRowCount: 0 });
    });

    it('seeds every historical tag exactly once', async () => {
      await seedHistoricalIfNeeded(fake.pool);
      expect(fake.inserted).toHaveLength(HISTORICAL_TAGS.size);
    });

    it('uses the real sha256 of each historical SQL file', async () => {
      await seedHistoricalIfNeeded(fake.pool);

      const expectedHashes = new Set(
        [...HISTORICAL_TAGS].map((tag) => sha256OfFile(tag)),
      );
      const actualHashes = new Set(fake.inserted.map((r) => r.hash));
      expect(actualHashes).toEqual(expectedHashes);
    });

    it('uses the journal `when` timestamp as created_at so migrate() treats the files as already applied', async () => {
      await seedHistoricalIfNeeded(fake.pool);

      for (const tag of HISTORICAL_TAGS) {
        const hash = sha256OfFile(tag);
        const when = readJournalEntry(tag).when;
        const row = fake.inserted.find((r) => r.hash === hash);
        expect(row, `no row seeded for ${tag}`).toBeDefined();
        expect(row!.createdAt).toBe(when);
      }
    });

    it('does not seed newer non-historical migrations (leaves them for migrate to apply)', async () => {
      await seedHistoricalIfNeeded(fake.pool);

      // 0004 is currently not in HISTORICAL_TAGS — it should NOT get seeded,
      // because we want drizzle-kit migrate() to actually execute it.
      const journal = JSON.parse(
        fs.readFileSync(path.join(realMigrationsFolder, 'meta', '_journal.json'), 'utf8'),
      );
      const unseededTags = journal.entries
        .filter((e: any) => !HISTORICAL_TAGS.has(e.tag))
        .map((e: any) => e.tag);

      // There's at least one (0004).
      expect(unseededTags.length).toBeGreaterThan(0);

      for (const tag of unseededTags) {
        const hash = sha256OfFile(tag);
        expect(
          fake.inserted.find((r) => r.hash === hash),
          `unexpected seed for non-historical ${tag}`,
        ).toBeUndefined();
      }
    });
  });

  describe('with a custom migrations folder', () => {
    it('reads journal + sql from the folder passed in (so tests can isolate fixtures)', async () => {
      // Build a minimal fixture folder with one "historical" migration and its
      // journal entry. We reuse an existing tag so the seed function accepts it.
      const tmp = fs.mkdtempSync(path.join(process.cwd(), 'drizzle-test-'));
      try {
        fs.mkdirSync(path.join(tmp, 'meta'));
        const fakeSql = '-- fixture only; not a real migration\nSELECT 1;\n';
        fs.writeFileSync(path.join(tmp, '0000_pale_vertigo.sql'), fakeSql);
        fs.writeFileSync(
          path.join(tmp, 'meta', '_journal.json'),
          JSON.stringify({
            version: '7',
            dialect: 'postgresql',
            entries: [
              { idx: 0, version: '7', when: 42, tag: '0000_pale_vertigo', breakpoints: true },
            ],
          }),
        );

        fake = makeFakePool({ listingsTableExists: true, migrationsRowCount: 0 });
        await seedHistoricalIfNeeded(fake.pool, tmp);

        expect(fake.inserted).toHaveLength(1);
        expect(fake.inserted[0].createdAt).toBe(42);
        expect(fake.inserted[0].hash).toBe(
          crypto.createHash('sha256').update(fakeSql).digest('hex'),
        );
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
