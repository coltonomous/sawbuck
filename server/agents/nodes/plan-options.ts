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
import { generateRefinishingPlan, type DifficultyContext } from '../../analysis/refinishing.js';
import { generateMaterialsFromPlanSync } from '../../analysis/sourcing.js';
import { getListingImageUrlForFal } from '../../lib/images.js';
import type { AgentState, RefinishingOption, ListingWithOptions, ConceptRenderResult } from '../state.js';
import logger from '../../lib/logger.js';

const CONCEPTS_DIR = 'data/images/concepts';

import type { RefinishingPlan } from '../../analysis/refinishing.js';

/**
 * Build a render prompt from the actual generated plan.
 * When a plan is available, the prompt describes the exact changes to apply.
 * Falls back to the concept summary if no plan was generated.
 */
function buildRenderPrompt(
  evaluation: ListingWithOptions['evaluation'],
  option: RefinishingOption,
  plan?: RefinishingPlan | null,
): string {
  const type = evaluation.furnitureType;

  if (plan) {
    const changes = plan.steps
      .map((s) => s.title.toLowerCase())
      .join(', ');

    if (option.difficulty === 'full') {
      return `A dramatically transformed ${type} based on the reference photo. Changes applied: ${plan.after_description}. Steps: ${changes}. Style: ${plan.style_recommendation}. The piece may have structural modifications, bold paint, or a completely new look. Photorealistic product photography, natural lighting.`;
    }

    const constraint = option.difficulty === 'simple'
      ? 'Keep the exact same piece, angle, shape, and proportions. Only change the finish/surface as described.'
      : 'Keep the same piece and general proportions. Updated hardware and finish should be visible.';

    return `The same ${type} shown in the reference photo, with these refinishing changes applied: ${plan.after_description}. Specific steps applied: ${changes}. Style: ${plan.style_recommendation}. ${constraint} Photorealistic product photography, natural lighting.`;
  }

  if (option.difficulty === 'full') {
    return `A dramatically transformed ${type} based on the reference photo. Changes: ${option.summary}. The piece may have structural modifications, bold paint, or a completely new look. Photorealistic product photography, natural lighting.`;
  }

  const constraint = option.difficulty === 'simple'
    ? 'Keep the exact same piece, angle, shape, and proportions. Only change the finish/surface as described.'
    : 'Keep the same piece and general proportions. Updated hardware and finish should be visible.';

  return `The same ${type} shown in the reference photo, with these changes applied: ${option.summary}. ${constraint} Photorealistic product photography, natural lighting.`;
}

const PLAN_OPTIONS_SYSTEM = `You are a furniture refinishing cost estimator. Given a piece of furniture with its condition and type, generate three refinishing options at different difficulty levels. Be realistic about time, material costs, and resale values based on the furniture type and condition.

The three difficulty levels should be VISUALLY DISTINCT from each other:

- "simple": Preserve the original character. Clean, oil, minor touch-ups. Minimal new materials. The piece should look cared-for but fundamentally unchanged.

- "moderate": A noticeable upgrade. New stain or finish that shifts the look, plus new hardware (knobs, pulls, hinges) where applicable. The piece should look refreshed and modernized, not just cleaned up.

- "full": A dramatic, transformative change. This means bold paint colors, two-tone treatments, structural modifications (adding legs, removing doors, converting function), or creative techniques like color washing, decoupage, or stencil work. The result should be barely recognizable as the same piece. Do NOT just do a nicer version of what moderate does — go in a completely different creative direction.`;

const OptionsSchema = z.object({
  options: z.array(z.object({
    difficulty: z.enum(['simple', 'moderate', 'full']).default('moderate'),
    label: z.string().default('Refinish'),
    summary: z.string().default(''),
    estimated_hours: z.number().default(0),
    estimated_material_cost: z.number().default(0),
    estimated_resale_price: z.number().default(0),
  })),
});

const OPTIONS_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    options: {
      type: 'array' as const,
      description: 'Three refinishing options at increasing difficulty',
      items: {
        type: 'object' as const,
        properties: {
          difficulty: { type: 'string' as const, enum: ['simple', 'moderate', 'full'] },
          label: { type: 'string' as const, description: 'Short name like "Quick Clean & Oil"' },
          summary: { type: 'string' as const, description: '2-3 sentence description of approach and expected outcome' },
          estimated_hours: { type: 'number' as const, description: 'Total hours of work' },
          estimated_material_cost: { type: 'number' as const, description: 'Total material cost in dollars' },
          estimated_resale_price: { type: 'number' as const, description: 'Expected resale price after refinishing' },
        },
        required: ['difficulty', 'label', 'summary', 'estimated_hours', 'estimated_material_cost', 'estimated_resale_price'] as const,
      },
    },
  },
  required: ['options'] as const,
};

function buildPrompt(listing: AgentState['qualifiedListings'][0]): string {
  const e = listing.evaluation;
  const parts = [
    `Furniture: ${e.furnitureType}`,
    `Style: ${e.furnitureStyle}`,
    `Condition: ${e.conditionScore}/10`,
    `Wood: ${e.woodSpecies || 'unknown'}`,
    `Asking price: $${listing.askingPrice ?? 'unknown'}`,
  ];
  if (e.profitVerdict) parts.push(`Assessment: ${e.profitVerdict}`);
  return `Generate three refinishing options (simple, moderate, full) for this piece:\n\n${parts.join('\n')}`;
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
      const prompt = buildPrompt(listing);
      const result = await analyzeWithVisionStructured(
        [],
        prompt,
        OPTIONS_JSON_SCHEMA,
        OptionsSchema,
        'refinishing_options',
        'Generate three refinishing options at different difficulty levels',
        PLAN_OPTIONS_SYSTEM,
        agentConfig.triageModel,
      );

      const options: RefinishingOption[] = result.options.map((o) => ({
        difficulty: o.difficulty,
        label: o.label,
        summary: o.summary,
        estimatedHours: o.estimated_hours,
        estimatedMaterialCost: o.estimated_material_cost,
        estimatedResalePrice: o.estimated_resale_price,
      }));

      results.push({ ...listing, options });

      // For each option: persist concept metadata, generate full plan, render image
      const hasFal = !!process.env.FAL_KEY;
      if (hasFal) await fs.mkdir(CONCEPTS_DIR, { recursive: true }).catch(() => {});

      // Upload reference image once per listing for img2img
      let referenceImageUrl: string | null = null;
      if (hasFal) {
        try {
          referenceImageUrl = await getListingImageUrlForFal(listing.listingId);
        } catch (err) {
          logger.debug({ listingId: listing.listingId, error: String(err) }, 'Could not get reference image');
        }
      }

      for (const option of options) {
        const diffCtx: DifficultyContext = {
          difficulty: option.difficulty as DifficultyContext['difficulty'],
          label: option.label,
          summary: option.summary,
          estimatedHours: option.estimatedHours,
          estimatedMaterialCost: option.estimatedMaterialCost,
          estimatedResalePrice: option.estimatedResalePrice,
        };

        // 1. Generate refinishing plan + materials
        let generatedPlan: RefinishingPlan | null = null;
        try {
          const planResult = await generateRefinishingPlan(listing.listingId, undefined, diffCtx);
          generatedPlan = planResult?.plan ?? null;

          // Generate materials from the stored plan
          if (generatedPlan) {
            const difficultyMap: Record<string, 'beginner' | 'intermediate' | 'advanced'> = {
              simple: 'beginner', moderate: 'intermediate', full: 'advanced',
            };
            const planDiff = difficultyMap[option.difficulty] ?? 'intermediate';
            const storedPlan = await db.select({ id: refinishingPlans.id })
              .from(refinishingPlans)
              .where(and(eq(refinishingPlans.listingId, listing.listingId), eq(refinishingPlans.difficultyLevel, planDiff)))
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
          logger.warn({ listingId: listing.listingId, difficulty: option.difficulty, error: String(err) }, 'Plan generation failed (non-fatal)');
        }

        // 2. Generate concept render + persist concept_renders row
        let renderPrompt = '';
        let localPath: string | null = null;
        let renderedImageUrl: string | null = null;

        if (hasFal) {
          try {
            renderPrompt = buildRenderPrompt(listing.evaluation, option, generatedPlan);
            const falInput: Record<string, unknown> = {
              prompt: renderPrompt,
              num_images: 1,
            };
            let falModel = agentConfig.falModel;
            if (referenceImageUrl) {
              falModel = 'fal-ai/flux/dev/image-to-image';
              falInput.image_url = referenceImageUrl;
              // Strength controls how much the render deviates from the reference image
              falInput.strength = option.difficulty === 'full' ? 0.75 : option.difficulty === 'moderate' ? 0.45 : 0.3;
            } else {
              falInput.image_size = { width: agentConfig.conceptRenderSize, height: agentConfig.conceptRenderSize };
            }
            const renderResult = await fal.subscribe(falModel, {
              input: falInput,
            }) as { data: { images: Array<{ url: string }> } };

            const imageUrl = renderResult.data?.images?.[0]?.url;
            if (imageUrl) {
              renderedImageUrl = imageUrl;
              const filename = `${listing.listingId}_${option.difficulty}.webp`;
              const filePath = path.join(CONCEPTS_DIR, filename);
              localPath = path.join('concepts', filename);
              const response = await fetch(imageUrl);
              const buffer = Buffer.from(await response.arrayBuffer());
              await sharp(buffer).webp({ quality: 85 }).toFile(filePath);

              renders.push({
                listingId: listing.listingId,
                difficulty: option.difficulty,
                conceptImageUrl: imageUrl,
                localPath,
                prompt: renderPrompt,
              });
            }
          } catch (err) {
            logger.warn({ listingId: listing.listingId, difficulty: option.difficulty, error: String(err) }, 'Concept render failed (non-fatal)');
          }
        }

        // 3. Persist concept_renders row (with or without render)
        await db.insert(conceptRenders).values({
          listingId: listing.listingId,
          agentRunId: state.runId,
          difficulty: option.difficulty,
          label: option.label,
          summary: option.summary,
          estimatedHours: option.estimatedHours,
          estimatedMaterialCost: option.estimatedMaterialCost,
          estimatedResalePrice: option.estimatedResalePrice,
          prompt: renderPrompt,
          renderedImageUrl,
          localPath,
        }).onConflictDoNothing();
      }

      logger.info({ listingId: listing.listingId, optionCount: options.length }, 'Plan options + plans + renders generated');
    } catch (err) {
      logger.error({ listingId: listing.listingId, error: String(err) }, 'Plan options failed');
      errors.push({ node: 'planOptions', message: `Listing ${listing.listingId}: ${String(err)}`, timestamp: new Date().toISOString() });
      // Still include listing without options so render can use defaults
      results.push({ ...listing, options: [] });
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
