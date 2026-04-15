/**
 * PostGIS initialization — idempotent, safe to run on every startup.
 *
 * - Creates the PostGIS extension
 * - Backfills the `geo` column from existing lat/lng data
 * - Creates a GiST spatial index on the `geo` column
 * - Creates a trigger to auto-populate `geo` on INSERT/UPDATE
 */

import { pool } from './index.js';
import logger from '../lib/logger.js';

export async function initPostGIS(): Promise<void> {
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS postgis');

    // Backfill geo from lat/lng where geo is NULL but coordinates exist
    const backfilled = await pool.query(`
      UPDATE listings
      SET geo = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
      WHERE latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND geo IS NULL
    `);
    if (backfilled.rowCount && backfilled.rowCount > 0) {
      logger.info({ count: backfilled.rowCount }, 'PostGIS: backfilled geo column');
    }

    // GiST spatial index (idempotent)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_listings_geo
      ON listings USING gist (geo)
    `);

    // Trigger function: auto-populate geo from lat/lng
    await pool.query(`
      CREATE OR REPLACE FUNCTION listings_update_geo()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
          NEW.geo := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
        ELSE
          NEW.geo := NULL;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // Attach trigger (drop + create to ensure it's up to date)
    await pool.query(`
      DROP TRIGGER IF EXISTS trg_listings_geo ON listings
    `);
    await pool.query(`
      CREATE TRIGGER trg_listings_geo
      BEFORE INSERT OR UPDATE OF latitude, longitude ON listings
      FOR EACH ROW EXECUTE FUNCTION listings_update_geo()
    `);

    logger.info('PostGIS: extension, index, and trigger ready');
  } catch (err) {
    logger.error({ err }, 'PostGIS initialization failed');
  }
}
