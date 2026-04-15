import { fal } from '@fal-ai/client';
import { db } from '../../db/index.js';
import { conceptRenders, refinishingPlans } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { agentConfig } from '../config.js';
import { reportProgress } from '../progress.js';
import { getListingImageUrlForFal } from '../../lib/images.js';
import type { AgentState, ConceptRenderResult, ListingWithOptions, FinishConcept } from '../state.js';
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
  concept: FinishConcept,
  plan?: PlanData | null,
): string {
  const type = evaluation.furnitureType;
  const afterDesc = plan?.after_description ?? concept.summary;
  const style = plan?.style_recommendation ?? concept.label;

  return `The same ${type} shown in the reference photo, refinished with: ${concept.label} — ${concept.summary}. After: ${afterDesc}. Style: ${style}. Keep the exact same piece, angle, shape, and proportions. Only change the finish/surface as described. Photorealistic product photography, natural lighting.`;
}

// Default finish concepts if generation failed
const DEFAULT_CONCEPTS: FinishConcept[] = [
  { finishType: 'stain', label: 'Natural Stain', summary: 'Light natural stain to showcase the wood grain with a satin polyurethane topcoat.' },
  { finishType: 'paint', label: 'Classic White Paint', summary: 'Clean white paint finish for a bright, modern farmhouse look.' },
  { finishType: 'oil', label: 'Danish Oil', summary: 'Warm danish oil finish that deepens the natural wood color with a soft sheen.' },
];

export async function generateConcepts(state: AgentState): Promise<Partial<AgentState>> {
  if (!process.env.FAL_KEY) {
    logger.info('Render: FAL_KEY not set, skipping concept renders');
    return { conceptRenders: [], conceptsRendered: state.conceptsRendered };
  }

  const listings = state.listingsWithOptions;

  if (listings.length === 0) {
    return { conceptRenders: [], conceptsRendered: state.conceptsRendered };
  }

  await ensureConceptsDir();
  const renders: ConceptRenderResult[] = [];
  const errors: AgentState['errors'] = [];

  for (const listing of listings) {
    const concepts = listing.concepts.length > 0 ? listing.concepts : DEFAULT_CONCEPTS;

    // Upload reference image once per listing for img2img
    let referenceImageUrl: string | null = null;
    try {
      referenceImageUrl = await getListingImageUrlForFal(listing.listingId);
    } catch (err) {
      logger.debug({ listingId: listing.listingId, error: String(err) }, 'Could not get reference image for concept render');
    }

    for (const concept of concepts) {
      // Fetch the plan for this listing to use in the render prompt
      let planData: PlanData | null = null;
      try {
        const plans = await db.select().from(refinishingPlans)
          .where(eq(refinishingPlans.listingId, listing.listingId));
        if (plans[0]) {
          const steps = typeof plans[0].steps === 'string' ? JSON.parse(plans[0].steps) : plans[0].steps;
          planData = {
            style_recommendation: plans[0].styleRecommendation ?? undefined,
            after_description: plans[0].afterDescription ?? undefined,
            steps,
          };
        }
      } catch {}

      const prompt = buildRenderPrompt(listing.evaluation, concept, planData);

      try {
        const falInput: Record<string, unknown> = {
          prompt,
          num_images: 1,
        };
        let falModel = agentConfig.falModel;
        if (referenceImageUrl) {
          falModel = 'fal-ai/flux/dev/image-to-image';
          falInput.image_url = referenceImageUrl;
          falInput.strength = 0.45;
        } else {
          falInput.image_size = { width: agentConfig.conceptRenderSize, height: agentConfig.conceptRenderSize };
        }

        const result = await fal.subscribe(falModel, {
          input: falInput,
        }) as { data: { images: Array<{ url: string }> } };

        const imageUrl = result.data?.images?.[0]?.url;
        if (!imageUrl) {
          errors.push({ node: 'render', message: `No image for listing ${listing.listingId} (${concept.finishType})`, timestamp: new Date().toISOString() });
          continue;
        }

        const filename = `${listing.listingId}_${concept.finishType}.webp`;
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
            eq(conceptRenders.finishType, concept.finishType),
          ));

        // If no existing row (shouldn't happen, but handle gracefully), insert
        if (!updated.rowCount) {
          await db.insert(conceptRenders).values({
            listingId: listing.listingId,
            agentRunId: state.runId,
            finishType: concept.finishType,
            label: concept.label,
            summary: concept.summary,
            prompt,
            renderedImageUrl: imageUrl,
            localPath: relativePath,
          });
        }

        renders.push({
          listingId: listing.listingId,
          finishType: concept.finishType,
          conceptImageUrl: imageUrl,
          localPath: relativePath,
          prompt,
        });

        logger.info({ listingId: listing.listingId, finishType: concept.finishType }, 'Concept render generated');
      } catch (err) {
        logger.error({ listingId: listing.listingId, finishType: concept.finishType, error: String(err) }, 'Render failed');
        errors.push({ node: 'render', message: `Listing ${listing.listingId} (${concept.finishType}): ${String(err)}`, timestamp: new Date().toISOString() });
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
