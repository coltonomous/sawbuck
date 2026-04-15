import { db } from '../../db/index.js';
import { listings, listingImages } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { analyzeListing } from '../../analysis/vision.js';
import { downloadListingImages } from '../../images/downloader.js';
import { processListingImages } from '../../images/processor.js';
import { calculatePricing, type PricingResult } from '../../analysis/pricing.js';
import { agentConfig } from '../config.js';
import type { AgentState, EvaluatedCandidate } from '../state.js';
import { reportProgress } from '../progress.js';
import logger from '../../lib/logger.js';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { IMAGES_DIR } from '../../lib/paths.js';

export async function evaluateCandidates(state: AgentState): Promise<Partial<AgentState>> {
  const evalCounts = state.evalCount;
  const maxPerPlatform = agentConfig.maxEvals;

  // Group by platform and apply per-platform budget
  const byPlatform = new Map<string, typeof state.passedTriage>();
  for (const c of state.passedTriage) {
    const group = byPlatform.get(c.platform) ?? [];
    group.push(c);
    byPlatform.set(c.platform, group);
  }

  const toEvaluate: typeof state.passedTriage = [];
  for (const [platform, candidates] of byPlatform) {
    const used = evalCounts[platform] ?? 0;
    const remaining = Math.max(0, maxPerPlatform - used);
    if (remaining > 0) {
      toEvaluate.push(...candidates.slice(0, remaining));
    } else {
      logger.info({ platform, used }, 'Evaluate: platform budget exhausted');
    }
  }

  const evaluated: EvaluatedCandidate[] = [];
  const qualified: EvaluatedCandidate[] = [];  // truly qualified (strong_buy/buy + deal score)
  const toTreat: EvaluatedCandidate[] = [];    // all non-dismissed — get full plans/renders
  const errors: AgentState['errors'] = [];

  for (const candidate of toEvaluate) {
    try {
      // Insert listing into DB as agent-discovered (userId = null)
      const inserted = await db.insert(listings).values({
        externalId: candidate.externalId,
        platform: candidate.platform as 'craigslist' | 'offerup' | 'ebay' | 'sawbuck',
        url: candidate.url,
        title: candidate.title,
        description: candidate.description ?? null,
        askingPrice: candidate.askingPrice,
        location: candidate.location || null,
        latitude: candidate.latitude ?? null,
        longitude: candidate.longitude ?? null,
        postedAt: candidate.postedAt ? new Date(candidate.postedAt) : null,
        userId: null, // shared agent listing
        triageSource: 'agent_eval',
        agentRunId: state.runId,
      }).onConflictDoNothing({ target: [listings.platform, listings.externalId] }).returning({ id: listings.id });

      if (inserted.length === 0) {
        logger.info({ externalId: candidate.externalId }, 'Evaluate: listing already exists, skipping');
        continue;
      }
      const listingId = inserted[0].id;

      // Insert images
      if (candidate.imageUrls.length > 0) {
        await db.insert(listingImages).values(
          candidate.imageUrls.slice(0, 3).map((url, i) => ({
            listingId,
            sourceUrl: url,
            isPrimary: i === 0,
          })),
        );
      }

      // Download, process, and analyze
      await downloadListingImages(listingId);
      await processListingImages(listingId);

      // Delete originals after processing — only if the resized WebP is valid
      // Update DB reference first, then delete file, so a crash never leaves
      // the DB pointing at a deleted file.
      const images = await db.select().from(listingImages).where(eq(listingImages.listingId, listingId));
      for (const img of images) {
        if (img.localPathOriginal && img.localPathResized) {
          try {
            const resizedFullPath = path.join(IMAGES_DIR, img.localPathResized);
            const metadata = await sharp(resizedFullPath).metadata();
            if (!metadata.width || !metadata.height) {
              logger.warn({ imagePath: img.localPathResized }, 'Resized image invalid, keeping original');
              continue;
            }
            await db.update(listingImages)
              .set({ localPathOriginal: null })
              .where(eq(listingImages.id, img.id));
            await fs.unlink(path.join(IMAGES_DIR, img.localPathOriginal));
          } catch {
            // not critical if cleanup fails — keep original as fallback
          }
        }
      }

      const analysis = await analyzeListing(listingId);
      if (!analysis) {
        errors.push({ node: 'evaluate', message: `Analysis failed for ${candidate.title}`, timestamp: new Date().toISOString() });
        continue;
      }

      // Skip pricing if eBay creds not configured
      let pricing: PricingResult | null = null;
      if (process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET) {
        pricing = await calculatePricing(listingId);
      }

      const evalCandidate: EvaluatedCandidate = {
        ...candidate,
        listingId,
        evaluation: {
          furnitureType: analysis.furniture_type,
          furnitureStyle: analysis.furniture_style,
          conditionScore: analysis.condition_score,
          woodSpecies: analysis.wood_species,
          estimatedValue: pricing?.estimatedValue ?? 0,
          dealScore: pricing?.dealScore ?? 0,
          flipRecommendation: analysis.flip_recommendation,
          refinishingPotential: analysis.refinishing_potential,
          profitVerdict: analysis.refinishing_profit_verdict,
        },
      };

      evaluated.push(evalCandidate);

      // Check if the verdict text contradicts the enum (model says "pass" in prose but "maybe" in the field)
      const verdictText = (analysis.refinishing_profit_verdict || '').toLowerCase();
      const verdictSaysPass = /\bpass\b|not worth|don't bother|negative profit|won't profit/.test(verdictText);
      const effectiveRecommendation = verdictSaysPass && analysis.flip_recommendation === 'maybe'
        ? 'pass'
        : analysis.flip_recommendation;

      const passesRecommendation2 = (agentConfig.flipRecommendationThreshold as readonly string[]).includes(effectiveRecommendation);
      const passesDealScore2 = pricing ? (pricing.dealScore >= agentConfig.dealScoreThreshold) : true;

      if (passesRecommendation2 && passesDealScore2) {
        qualified.push(evalCandidate);
        toTreat.push(evalCandidate);
      } else if (effectiveRecommendation === 'pass') {
        // Clear pass — dismiss from feed, no plans/renders
        await db.update(listings)
          .set({ status: 'dismissed' })
          .where(eq(listings.id, listingId));
        logger.info({ listingId, recommendation: effectiveRecommendation, original: analysis.flip_recommendation }, 'Evaluate: dismissed (pass)');
      } else {
        // 'maybe' — not qualified but still worth the full treatment at low volume
        toTreat.push(evalCandidate);
      }

      logger.info(
        { listingId, title: candidate.title, recommendation: analysis.flip_recommendation, dealScore: pricing?.dealScore },
        'Evaluate: listing analyzed',
      );
    } catch (err) {
      logger.error({ title: candidate.title, error: String(err) }, 'Evaluate: failed for listing');
      errors.push({ node: 'evaluate', message: `${candidate.title}: ${String(err)}`, timestamp: new Date().toISOString() });
    }
  }

  logger.info({ evaluated: evaluated.length, qualified: qualified.length, toTreat: toTreat.length }, 'Evaluate node complete');

  // Update per-platform eval counts
  const updatedEvalCounts = { ...evalCounts };
  for (const e of evaluated) {
    updatedEvalCounts[e.platform] = (updatedEvalCounts[e.platform] ?? 0) + 1;
  }

  const totalEvaluated = Object.values(updatedEvalCounts).reduce((a, b) => a + b, 0);
  reportProgress(state.runId, {
    evaluated: totalEvaluated,
    qualified: state.qualifiedCount + qualified.length,
  });

  return {
    evaluatedCandidates: evaluated,
    qualifiedListings: toTreat, // all non-dismissed listings get full plans/renders
    evalCount: updatedEvalCounts,
    qualifiedCount: state.qualifiedCount + qualified.length, // only true qualifieds for loop control
    errors,
  };
}
