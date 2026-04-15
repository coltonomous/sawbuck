import { fal } from '@fal-ai/client';
import { db } from '../../db/index.js';
import { conceptRenders, refinishingPlans } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { agentConfig } from '../config.js';
import { reportProgress } from '../progress.js';
import { getListingImageUrlForFal } from '../../lib/images.js';
import type { AgentState, ConceptRenderResult, ListingWithOptions, RefinishingOption } from '../state.js';
import logger from '../../lib/logger.js';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

const CONCEPTS_DIR = 'data/images/concepts';

async function ensureConceptsDir(): Promise<void> {
  await fs.mkdir(CONCEPTS_DIR, { recursive: true });
}

interface PlanData {
  style_recommendation?: string;
  after_description?: string;
  steps?: Array<{ title: string }>;
}

function buildRenderPrompt(
  evaluation: ListingWithOptions['evaluation'],
  option: RefinishingOption,
  plan?: PlanData | null,
): string {
  const type = evaluation.furnitureType;

  if (plan?.after_description) {
    const changes = plan.steps
      ?.map((s) => s.title.toLowerCase())
      .join(', ') ?? option.summary;

    if (option.difficulty === 'full') {
      return `A dramatically transformed ${type} based on the reference photo. Changes applied: ${plan.after_description}. Steps: ${changes}. Style: ${plan.style_recommendation ?? ''}. The piece may have structural modifications, bold paint, or a completely new look. Photorealistic product photography, natural lighting.`;
    }

    const constraint = option.difficulty === 'simple'
      ? 'Keep the exact same piece, angle, shape, and proportions. Only change the finish/surface as described.'
      : 'Keep the same piece and general proportions. Updated hardware and finish should be visible.';

    return `The same ${type} shown in the reference photo, with these refinishing changes applied: ${plan.after_description}. Specific steps applied: ${changes}. Style: ${plan.style_recommendation ?? ''}. ${constraint} Photorealistic product photography, natural lighting.`;
  }

  if (option.difficulty === 'full') {
    return `A dramatically transformed ${type} based on the reference photo. Changes: ${option.summary}. The piece may have structural modifications, bold paint, or a completely new look. Photorealistic product photography, natural lighting.`;
  }

  const constraint = option.difficulty === 'simple'
    ? 'Keep the exact same piece, angle, shape, and proportions. Only change the finish/surface as described.'
    : 'Keep the same piece and general proportions. Updated hardware and finish should be visible.';

  return `The same ${type} shown in the reference photo, with these changes applied: ${option.summary}. ${constraint} Photorealistic product photography, natural lighting.`;
}

// Default options if plan generation failed
const DEFAULT_OPTIONS: RefinishingOption[] = [
  { difficulty: 'simple', label: 'Quick Clean & Oil', summary: 'cleaned and oiled with natural finish, minimal intervention.', estimatedHours: 2, estimatedMaterialCost: 30, estimatedResalePrice: 0 },
  { difficulty: 'moderate', label: 'Sand, Refinish & New Hardware', summary: 'sanded and refinished with a fresh stain, fitted with new modern hardware for an updated look.', estimatedHours: 8, estimatedMaterialCost: 80, estimatedResalePrice: 0 },
  { difficulty: 'full', label: 'Creative Transformation', summary: 'dramatically reimagined with bold paint, structural modifications, and a completely new aesthetic — barely recognizable as the original piece.', estimatedHours: 20, estimatedMaterialCost: 150, estimatedResalePrice: 0 },
];

export async function generateConcepts(state: AgentState): Promise<Partial<AgentState>> {
  if (!process.env.FAL_KEY) {
    logger.info('Render: FAL_KEY not set, skipping concept renders');
    return { conceptRenders: [], conceptsRendered: state.conceptsRendered };
  }

  // All listings with options are already qualified — render all of them.
  const listings = state.listingsWithOptions;

  if (listings.length === 0) {
    return { conceptRenders: [], conceptsRendered: state.conceptsRendered };
  }

  await ensureConceptsDir();
  const renders: ConceptRenderResult[] = [];
  const errors: AgentState['errors'] = [];

  for (const listing of listings) {
    const options = listing.options.length > 0 ? listing.options : DEFAULT_OPTIONS;

    // Upload reference image once per listing for img2img
    let referenceImageUrl: string | null = null;
    try {
      referenceImageUrl = await getListingImageUrlForFal(listing.listingId);
    } catch (err) {
      logger.debug({ listingId: listing.listingId, error: String(err) }, 'Could not get reference image for concept render');
    }

    for (const option of options) {
      // Fetch the plan for this listing+difficulty to use in the render prompt
      const difficultyMap: Record<string, 'beginner' | 'intermediate' | 'advanced'> = { simple: 'beginner', moderate: 'intermediate', full: 'advanced' };
      let planData: PlanData | null = null;
      try {
        const planDiff = difficultyMap[option.difficulty] ?? 'intermediate';
        const plans = await db.select().from(refinishingPlans)
          .where(and(eq(refinishingPlans.listingId, listing.listingId), eq(refinishingPlans.difficultyLevel, planDiff)));
        if (plans[0]) {
          const steps = typeof plans[0].steps === 'string' ? JSON.parse(plans[0].steps) : plans[0].steps;
          planData = {
            style_recommendation: plans[0].styleRecommendation ?? undefined,
            after_description: plans[0].afterDescription ?? undefined,
            steps,
          };
        }
      } catch {}

      const prompt = buildRenderPrompt(listing.evaluation, option, planData);

      try {
        const falInput: Record<string, unknown> = {
          prompt,
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

        const result = await fal.subscribe(falModel, {
          input: falInput,
        }) as { data: { images: Array<{ url: string }> } };

        const imageUrl = result.data?.images?.[0]?.url;
        if (!imageUrl) {
          errors.push({ node: 'render', message: `No image for listing ${listing.listingId} (${option.difficulty})`, timestamp: new Date().toISOString() });
          continue;
        }

        const filename = `${listing.listingId}_${option.difficulty}.webp`;
        const filePath = path.join(CONCEPTS_DIR, filename);
        const relativePath = path.join('concepts', filename);
        const response = await fetch(imageUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        await sharp(buffer).webp({ quality: 85 }).toFile(filePath);

        // Update the row created by plan-options with the rendered image
        const updated = await db.update(conceptRenders)
          .set({ prompt, renderedImageUrl: imageUrl, localPath: relativePath })
          .where(and(
            eq(conceptRenders.listingId, listing.listingId),
            eq(conceptRenders.difficulty, option.difficulty),
          ));

        // If no existing row (shouldn't happen, but handle gracefully), insert
        if (!updated.rowCount) {
          await db.insert(conceptRenders).values({
            listingId: listing.listingId,
            agentRunId: state.runId,
            difficulty: option.difficulty,
            label: option.label,
            summary: option.summary,
            estimatedHours: option.estimatedHours,
            estimatedMaterialCost: option.estimatedMaterialCost,
            estimatedResalePrice: option.estimatedResalePrice,
            prompt,
            renderedImageUrl: imageUrl,
            localPath: relativePath,
          });
        }

        renders.push({
          listingId: listing.listingId,
          difficulty: option.difficulty,
          conceptImageUrl: imageUrl,
          localPath: relativePath,
          prompt,
        });

        logger.info({ listingId: listing.listingId, difficulty: option.difficulty }, 'Concept render generated');
      } catch (err) {
        logger.error({ listingId: listing.listingId, difficulty: option.difficulty, error: String(err) }, 'Render failed');
        errors.push({ node: 'render', message: `Listing ${listing.listingId} (${option.difficulty}): ${String(err)}`, timestamp: new Date().toISOString() });
      }
    }
  }

  logger.info({ rendered: renders.length, listings: listings.length }, 'Render node complete');

  reportProgress(state.runId, { rendered: state.conceptsRendered + listings.length });

  return {
    conceptRenders: renders,
    conceptsRendered: state.conceptsRendered + listings.length,
    errors,
  };
}
