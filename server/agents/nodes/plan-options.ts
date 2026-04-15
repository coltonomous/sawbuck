import { z } from 'zod';
import { fal } from '@fal-ai/client';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { analyzeWithVisionStructured } from '../../lib/bedrock.js';
import { db } from '../../db/index.js';
import { conceptRenders, refinishingPlans } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { agentConfig } from '../config.js';
import { reportProgress } from '../progress.js';
import { generateRefinishingPlan } from '../../analysis/refinishing.js';
import { generateMaterialsFromPlanSync } from '../../analysis/sourcing.js';
import { getListingImageUrlForFal } from '../../lib/images.js';
import type { AgentState, FinishConcept, ListingWithOptions, ConceptRenderResult } from '../state.js';
import logger from '../../lib/logger.js';
import { env } from '../../lib/env.js';

const CONCEPTS_DIR = 'data/images/concepts';

import type { RefinishingPlan } from '../../analysis/refinishing.js';

/**
 * Build a render prompt from the plan + finish concept.
 * The prompt describes the same piece with a specific surface finish applied.
 * Must be aggressive enough that Flux img2img produces a visibly different surface.
 */
function buildRenderPrompt(
  evaluation: ListingWithOptions['evaluation'],
  concept: FinishConcept,
  plan?: RefinishingPlan | null,
): string {
  const type = evaluation.furnitureType;
  const afterDesc = plan?.after_description ?? concept.summary;
  const style = plan?.style_recommendation ?? concept.label;

  const isPaint = /paint|chalk|milk|lacquer|enamel/i.test(concept.finishType) || /paint|chalk|milk|lacquer|enamel/i.test(concept.summary);

  if (isPaint) {
    return `A ${type} with a ${concept.label} finish. ${concept.summary}. The entire surface is covered in ${concept.label} — no bare wood visible. The paint color, sheen, and texture must dominate the image. Style: ${style}. Same piece shape and proportions as the reference photo. Photorealistic product photography, studio lighting with specular highlights to show the paint finish.`;
  }

  return `The same ${type} from the reference photo with a completely different surface finish: ${concept.label}. ${concept.summary}. After: ${afterDesc}. The surface color, sheen, and texture must be clearly different from the original — show the ${concept.finishType} finish in sharp detail (grain, tone, reflectivity). Style: ${style}. Same piece shape and proportions. Photorealistic product photography, studio lighting angled to highlight the surface texture and finish quality.`;
}

/**
 * Pick img2img strength based on finish type.
 * Paint/opaque finishes need higher strength since the surface color changes completely.
 * Stain/oil finishes can use lower strength to preserve wood grain detail.
 */
function renderStrength(concept: FinishConcept): number {
  const isPaint = /paint|chalk|milk|lacquer|enamel/i.test(concept.finishType) || /paint|chalk|milk|lacquer|enamel/i.test(concept.summary);
  return isPaint ? 0.78 : 0.55;
}

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
      const hasFal = env.hasFal;
      if (hasFal) await fs.mkdir(CONCEPTS_DIR, { recursive: true }).catch(() => {});

      let referenceImageUrl: string | null = null;
      if (hasFal) {
        try {
          referenceImageUrl = await getListingImageUrlForFal(listing.listingId);
        } catch (err) {
          logger.debug({ listingId: listing.listingId, error: String(err) }, 'Could not get reference image');
        }
      }

      for (const concept of concepts) {
        let renderPrompt = '';
        let localPath: string | null = null;
        let renderedImageUrl: string | null = null;

        if (hasFal) {
          try {
            renderPrompt = buildRenderPrompt(listing.evaluation, concept, generatedPlan);
            const falInput: Record<string, unknown> = {
              prompt: renderPrompt,
              num_images: 1,
            };
            let falModel = agentConfig.falModel;
            if (referenceImageUrl) {
              falModel = 'fal-ai/flux/dev/image-to-image';
              falInput.image_url = referenceImageUrl;
              falInput.strength = renderStrength(concept);
            } else {
              falInput.image_size = { width: agentConfig.conceptRenderSize, height: agentConfig.conceptRenderSize };
            }
            const renderResult = await fal.subscribe(falModel, {
              input: falInput,
            }) as { data: { images: Array<{ url: string }> } };

            const imageUrl = renderResult.data?.images?.[0]?.url;
            if (imageUrl) {
              renderedImageUrl = imageUrl;
              const filename = `${listing.listingId}_${concept.finishType}.webp`;
              const filePath = path.join(CONCEPTS_DIR, filename);
              localPath = path.join('concepts', filename);
              const response = await fetch(imageUrl);
              const buffer = Buffer.from(await response.arrayBuffer());
              await sharp(buffer).webp({ quality: 85 }).toFile(filePath);

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

        // Persist concept_renders row (with or without render)
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
