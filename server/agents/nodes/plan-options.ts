import { z } from 'zod';
import { fal } from '@fal-ai/client';
import sharp from 'sharp';
import { analyzeWithVisionStructured } from '../../lib/bedrock.js';
import { db } from '../../db/index.js';
import { conceptRenders, refinishingPlans } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { agentConfig } from '../config.js';
import { reportProgress } from '../progress.js';
import { generateRefinishingPlan } from '../../analysis/refinishing.js';
import { generateMaterialsFromPlanSync } from '../../analysis/sourcing.js';
import type { AgentState, FinishConcept, ListingWithOptions, ConceptRenderResult } from '../state.js';
import logger from '../../lib/logger.js';
import { uploadToS3 } from '../../lib/s3.js';

import type { RefinishingPlan } from '../../analysis/refinishing.js';

import { buildConceptRenderRequest } from '../../lib/render-prompt.js';
import { getListingImageUrlForFal } from '../../lib/images.js';

const FINISH_CONCEPTS_SYSTEM = `You are a furniture refinishing advisor. Given a piece of furniture, suggest finish options that would maximize resale value. Each concept should describe a different surface treatment — stain, paint, oil, varnish, etc. — appropriate for the piece's wood species, style, and condition. Focus on finishes that are realistic for a hobbyist and popular in the resale market.`;

const ConceptsSchema = z.object({
  concepts: z.array(z.object({
    finishType: z.string().default('stain'),
    label: z.string().default('Natural Finish'),
    summary: z.string().default(''),
  })),
});

const CONCEPTS_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    concepts: {
      type: 'array' as const,
      description: '3 finish concepts showing different surface treatments',
      items: {
        type: 'object' as const,
        properties: {
          finishType: { type: 'string' as const, description: 'Category of finish: stain, paint, oil, varnish, wax, chalk_paint, milk_paint, lacquer' },
          label: { type: 'string' as const, description: 'Descriptive name like "Dark Walnut Stain" or "Chalk White Paint"' },
          summary: { type: 'string' as const, description: '1-2 sentence description of the look and why it works for this piece' },
        },
        required: ['finishType', 'label', 'summary'] as const,
      },
    },
  },
  required: ['concepts'] as const,
};

function buildConceptsPrompt(listing: AgentState['qualifiedListings'][0]): string {
  const e = listing.evaluation;
  const parts = [
    `Furniture: ${e.furnitureType}`,
    `Style: ${e.furnitureStyle}`,
    `Condition: ${e.conditionScore}/10`,
    `Wood: ${e.woodSpecies || 'unknown'}`,
    `Asking price: $${listing.askingPrice ?? 'unknown'}`,
  ];
  if (e.profitVerdict) parts.push(`Assessment: ${e.profitVerdict}`);
  return `Suggest 3 different finish concepts for this piece. Each should be a different surface treatment (stain, paint, oil, varnish, etc.) that would look good on this specific piece and appeal to buyers. Include a mix of natural/stain options and painted options where appropriate for the wood and style:\n\n${parts.join('\n')}`;
}

export async function generatePlanOptions(state: AgentState): Promise<Partial<AgentState>> {
  const listings = state.qualifiedListings;
  if (listings.length === 0) {
    return { listingsWithOptions: [] };
  }

  const results: ListingWithOptions[] = [];
  const renders: ConceptRenderResult[] = [];
  const errors: AgentState['errors'] = [];

  for (const listing of listings) {
    try {
      // 1. Generate finish concepts (what surface treatments to show)
      const conceptsPrompt = buildConceptsPrompt(listing);
      const conceptResult = await analyzeWithVisionStructured(
        [],
        conceptsPrompt,
        CONCEPTS_JSON_SCHEMA,
        ConceptsSchema,
        'finish_concepts',
        'Suggest finish concepts for this furniture piece',
        FINISH_CONCEPTS_SYSTEM,
        agentConfig.triageModel,
      );

      const concepts: FinishConcept[] = conceptResult.concepts.map((c) => ({
        finishType: c.finishType,
        label: c.label,
        summary: c.summary,
      }));

      results.push({ ...listing, concepts });

      // 2. Generate one refinishing plan for the piece
      let generatedPlan: RefinishingPlan | null = null;
      try {
        const planResult = await generateRefinishingPlan(listing.listingId);
        generatedPlan = planResult?.plan ?? null;

        // Generate materials from the plan
        if (generatedPlan) {
          const storedPlan = await db.select({ id: refinishingPlans.id })
            .from(refinishingPlans)
            .where(eq(refinishingPlans.listingId, listing.listingId))
            .orderBy(refinishingPlans.id)
            .then(r => r[r.length - 1]);
          if (storedPlan) {
            try {
              await generateMaterialsFromPlanSync(storedPlan.id);
            } catch (err) {
              logger.warn({ listingId: listing.listingId, planId: storedPlan.id, error: String(err) }, 'Materials generation failed (non-fatal)');
            }
          }
        }
      } catch (err) {
        logger.warn({ listingId: listing.listingId, error: String(err) }, 'Plan generation failed (non-fatal)');
      }

      // 3. Generate concept renders + persist concept_renders rows
      const hasFal = !!process.env.FAL_KEY;

      let referenceImageUrl: string | null = null;
      if (hasFal) {
        try {
          referenceImageUrl = await getListingImageUrlForFal(listing.listingId);
        } catch (err) {
          logger.debug({ listingId: listing.listingId, error: String(err) }, 'Could not get reference image');
        }
      }

      // Render all concepts in parallel (with timeout) then persist rows
      const FAL_TIMEOUT_MS = 120_000; // 2 min per render
      const renderResults = await Promise.all(concepts.map(async (concept) => {
        let renderPrompt = '';
        let localPath: string | null = null;
        let renderedImageUrl: string | null = null;

        if (hasFal) {
          try {
            const { model: falModel, input: falInput } = buildConceptRenderRequest({
              concept,
              furnitureType: listing.evaluation.furnitureType,
              referenceImageUrl,
              conceptEditModel: agentConfig.conceptEditModel,
              textToImageModel: agentConfig.falModel,
              imageSize: agentConfig.conceptRenderSize,
              afterDescription: generatedPlan?.after_description,
              styleRecommendation: generatedPlan?.style_recommendation,
            });
            renderPrompt = falInput.prompt as string;

            // fal SDK timeout is not enforced (per SDK docs), so use Promise.race
            const renderResult = await Promise.race([
              fal.subscribe(falModel, { input: falInput }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Render timed out after ${FAL_TIMEOUT_MS / 1000}s`)), FAL_TIMEOUT_MS)
              ),
            ]) as { data: { images: Array<{ url: string }> } };

            const imageUrl = renderResult.data?.images?.[0]?.url;
            if (imageUrl) {
              renderedImageUrl = imageUrl;
              const s3Key = `concepts/${listing.listingId}_${concept.finishType}.webp`;
              localPath = s3Key;
              const response = await fetch(imageUrl);
              const buffer = Buffer.from(await response.arrayBuffer());
              const webpBuffer = await sharp(buffer).webp({ quality: 85 }).toBuffer();
              await uploadToS3(s3Key, webpBuffer, 'image/webp');

              renders.push({
                listingId: listing.listingId,
                finishType: concept.finishType,
                conceptImageUrl: imageUrl,
                localPath,
                prompt: renderPrompt,
              });
            }
          } catch (err) {
            logger.warn({ listingId: listing.listingId, finishType: concept.finishType, error: String(err) }, 'Concept render failed (non-fatal)');
          }
        }

        return { concept, renderPrompt, renderedImageUrl, localPath };
      }));

      // Persist concept_renders rows
      for (const { concept, renderPrompt, renderedImageUrl, localPath } of renderResults) {
        await db.insert(conceptRenders).values({
          listingId: listing.listingId,
          agentRunId: state.runId,
          finishType: concept.finishType,
          label: concept.label,
          summary: concept.summary,
          prompt: renderPrompt,
          renderedImageUrl,
          localPath,
        }).onConflictDoNothing({ target: [conceptRenders.listingId, conceptRenders.finishType] });
      }

      logger.info({ listingId: listing.listingId, conceptCount: concepts.length }, 'Plan + finish concepts generated');
    } catch (err) {
      logger.error({ listingId: listing.listingId, error: String(err) }, 'Plan options failed');
      errors.push({ node: 'planOptions', message: `Listing ${listing.listingId}: ${String(err)}`, timestamp: new Date().toISOString() });
      results.push({ ...listing, concepts: [] });
    }
  }

  logger.info({ count: results.length, renders: renders.length }, 'Plan options node complete');

  reportProgress(state.runId, { rendered: renders.length });

  return {
    listingsWithOptions: results,
    conceptRenders: renders,
    conceptsRendered: renders.length,
    errors,
  };
}
