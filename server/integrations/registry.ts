import { db } from '../db/index.js';
import { platformSettings, regions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { PlatformIntegration, Region } from './common/types.js';
import { CraigslistIntegration } from './craigslist/index.js';
import { OfferUpIntegration } from './offerup/index.js';
import logger from '../lib/logger.js';

const integrations = new Map<string, PlatformIntegration>();
integrations.set('craigslist', new CraigslistIntegration());
integrations.set('offerup', new OfferUpIntegration());

export function getIntegration(platform: string): PlatformIntegration | undefined {
  return integrations.get(platform);
}

export function registerPlatform(name: string, integration: PlatformIntegration): void {
  integrations.set(name, integration);
}

export async function getEnabledPlatforms(): Promise<PlatformIntegration[]> {
  const settings = await db.select().from(platformSettings).where(eq(platformSettings.enabled, true));
  const result: PlatformIntegration[] = [];
  for (const s of settings) {
    const integration = integrations.get(s.platform);
    if (integration) {
      result.push(integration);
    } else {
      logger.warn({ platform: s.platform }, 'Platform enabled but no integration registered');
    }
  }
  return result;
}

export async function getEnabledRegions(): Promise<Region[]> {
  return db.select().from(regions).where(eq(regions.enabled, true));
}

/**
 * Seed default platform settings and regions if tables are empty.
 * Called on server startup (idempotent).
 */
export async function seedPlatformDefaults(): Promise<void> {
  const existing = await db.select().from(platformSettings);
  if (existing.length === 0) {
    await db.insert(platformSettings).values([
      { platform: 'craigslist', enabled: true },
      { platform: 'offerup', enabled: false },
    ]).onConflictDoNothing();
    logger.info('Seeded default platform settings');
  }

  const existingRegions = await db.select().from(regions);
  if (existingRegions.length === 0) {
    // Seed from legacy agent.target_city config or default to seattle
    const { agentConfig } = await import('../agents/config.js');
    const city = agentConfig.targetCity || 'seattle';
    // Default coords for seattle; admin can update via UI
    const CITY_DEFAULTS: Record<string, { lat: number; lng: number }> = {
      seattle: { lat: 47.6062, lng: -122.3321 },
      portland: { lat: 45.5152, lng: -122.6784 },
      denver: { lat: 39.7392, lng: -104.9903 },
    };
    const coords = CITY_DEFAULTS[city] ?? { lat: 47.6062, lng: -122.3321 };
    await db.insert(regions).values({
      name: city,
      latitude: coords.lat,
      longitude: coords.lng,
      radiusMiles: 30,
      clSubdomain: city,
      enabled: true,
    }).onConflictDoNothing();
    logger.info({ city }, 'Seeded default region');
  }
}
