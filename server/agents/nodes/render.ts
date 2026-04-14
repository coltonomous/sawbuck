import { fal } from '@fal-ai/client';
import { db } from '../../db/index.js';
import { conceptRenders } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { agentConfig } from '../config.js';
import { reportProgress } from '../progress.js';
import type { AgentState, ConceptRenderResult, ListingWithOptions, RefinishingOption } from '../state.js';
import logger from '../../lib/logger.js';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

const CONCEPTS_DIR = 'data/images/concepts';

async function ensureConceptsDir(): Promise<void> {
  await fs.mkdir(CONCEPTS_DIR, { recursive: true });
}

function buildRenderPrompt(
  evaluation: ListingWithOptions['evaluation'],
  option: RefinishingOption,
): string {
  const type = evaluation.furnitureType;
  const style = evaluation.furnitureStyle;
  const wood = evaluation.woodSpecies;

  if (option.difficulty === 'full') {
    // Full transformation: dramatically different look, updated style, new hardware, contrasting finish
    return `Professional furniture photography of a completely redesigned ${type}, transformed from ${style || 'traditional'} style into a modern boutique showpiece. ${wood ? `Originally ${wood} wood, now` : 'Now'} with a bold contrasting finish, new premium hardware, fresh upholstery or accent details. Styled in a high-end interior design setting. Studio lighting, editorial photography style.`;
  }

  return `Professional furniture photography of a ${type}${style ? ` in ${style} style` : ''}${wood ? `, ${wood} wood` : ''}, ${option.summary} Staged in a bright modern living room. Warm natural lighting, clean background, product photography style.`;
}

// Default options if plan generation failed
const DEFAULT_OPTIONS: RefinishingOption[] = [
  { difficulty: 'simple', label: 'Quick Clean & Oil', summary: 'cleaned and oiled with natural finish, minimal intervention.', estimatedHours: 2, estimatedMaterialCost: 30, estimatedResalePrice: 0 },
  { difficulty: 'moderate', label: 'Sand & Refinish', summary: 'sanded and refinished with a smooth satin stain, updated hardware.', estimatedHours: 8, estimatedMaterialCost: 80, estimatedResalePrice: 0 },
  { difficulty: 'full', label: 'Full Transformation', summary: 'completely transformed with professional-grade finish, premium hardware.', estimatedHours: 20, estimatedMaterialCost: 150, estimatedResalePrice: 0 },
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

    for (const option of options) {
      const prompt = buildRenderPrompt(listing.evaluation, option);

      try {
        const result = await fal.subscribe(agentConfig.falModel, {
          input: {
            prompt,
            image_size: {
              width: agentConfig.conceptRenderSize,
              height: agentConfig.conceptRenderSize,
            },
            num_images: 1,
          },
        }) as { data: { images: Array<{ url: string }> } };

        const imageUrl = result.data?.images?.[0]?.url;
        if (!imageUrl) {
          errors.push({ node: 'render', message: `No image for listing ${listing.listingId} (${option.difficulty})`, timestamp: new Date().toISOString() });
          continue;
        }

        const filename = `${listing.listingId}_${option.difficulty}.webp`;
        const localPath = path.join(CONCEPTS_DIR, filename);
        const response = await fetch(imageUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        await sharp(buffer).webp({ quality: 85 }).toFile(localPath);

        // Update the row created by plan-options with the rendered image
        const updated = await db.update(conceptRenders)
          .set({ prompt, renderedImageUrl: imageUrl, localPath })
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
            localPath,
          });
        }

        renders.push({
          listingId: listing.listingId,
          difficulty: option.difficulty,
          conceptImageUrl: imageUrl,
          localPath,
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
