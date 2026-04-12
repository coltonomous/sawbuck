import { z } from 'zod';
import { analyzeWithVisionStructured } from '../../lib/bedrock.js';
import { db } from '../../db/index.js';
import { conceptRenders } from '../../db/schema.js';
import { agentConfig } from '../config.js';
import type { AgentState, RefinishingOption, ListingWithOptions } from '../state.js';
import logger from '../../lib/logger.js';

const PLAN_OPTIONS_SYSTEM = `You are a furniture refinishing cost estimator. Given a piece of furniture with its condition and type, generate three refinishing options at different difficulty levels. Be realistic about time, material costs, and resale values based on the furniture type and condition.`;

const OptionsSchema = z.object({
  options: z.array(z.object({
    difficulty: z.enum(['simple', 'moderate', 'full']),
    label: z.string(),
    summary: z.string(),
    estimated_hours: z.number(),
    estimated_material_cost: z.number(),
    estimated_resale_price: z.number(),
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

      // Persist all options to DB so they're visible in the feed even without renders
      for (const option of options) {
        await db.insert(conceptRenders).values({
          listingId: listing.listingId,
          agentRunId: state.runId,
          difficulty: option.difficulty,
          label: option.label,
          summary: option.summary,
          estimatedHours: option.estimatedHours,
          estimatedMaterialCost: option.estimatedMaterialCost,
          estimatedResalePrice: option.estimatedResalePrice,
          prompt: '',     // render node fills this in later
          localPath: null, // render node fills this in later
        }).onConflictDoNothing();
      }

      results.push({ ...listing, options });

      logger.info({ listingId: listing.listingId, optionCount: options.length }, 'Plan options generated');
    } catch (err) {
      logger.error({ listingId: listing.listingId, error: String(err) }, 'Plan options failed');
      errors.push({ node: 'planOptions', message: `Listing ${listing.listingId}: ${String(err)}`, timestamp: new Date().toISOString() });
      // Still include listing without options so render can use defaults
      results.push({ ...listing, options: [] });
    }
  }

  logger.info({ count: results.length }, 'Plan options node complete');

  return { listingsWithOptions: results, errors };
}
