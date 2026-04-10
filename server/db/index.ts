import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { DB_PATH } from '../lib/paths.js';

const sqlite: DatabaseType = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Register math functions for Haversine distance queries
sqlite.function('radians', (deg: number) => deg * Math.PI / 180);
sqlite.function('cos', (x: number) => Math.cos(x));
sqlite.function('sin', (x: number) => Math.sin(x));
sqlite.function('acos', (x: number) => Math.acos(Math.min(1, Math.max(-1, x))));

export const db = drizzle(sqlite, { schema });
export { sqlite };
