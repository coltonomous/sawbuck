import { z } from 'zod';
import { db } from '../db/index.js';
import { listings, refinishingPlans, conceptRenders } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { generateText, extractJson } from '../lib/bedrock.js';
import { getFullContext } from '../rag/retrieval.js';
import logger from '../lib/logger.js';

const ProductSchema = z.object({
  name: z.string(),
  brand: z.string(),
  quantity: z.number(),
  unit: z.string(),
  estimated_price: z.number(),
});

const StepSchema = z.object({
  order: z.number(),
  title: z.string(),
  description: z.string(),
  duration_minutes: z.number(),
  products: z.array(ProductSchema),
  tips: z.array(z.string()),
});

const RefinishingPlanSchema = z.object({
  style_recommendation: z.string(),
  description: z.string(),
  difficulty_level: z.enum(['beginner', 'intermediate', 'advanced']),
  before_description: z.string(),
  after_description: z.string(),
  steps: z.array(StepSchema),
  estimated_total_hours: z.number(),
  estimated_material_cost: z.number(),
  estimated_resale_price: z.number(),
});

export type RefinishingPlan = z.infer<typeof RefinishingPlanSchema>;
export type RefinishingStep = z.infer<typeof StepSchema>;
export type RefinishingProduct = z.infer<typeof ProductSchema>;

const SYSTEM_PROMPT = `You are a brutally honest furniture refinisher with 20+ years specializing in restoration and upcycling for resale. You don't inflate resale estimates to make a project feel worthwhile. You don't underestimate time or cost to make the work sound easy.

You recommend specific products by brand name and provide precise quantities. Your time estimates are for a hobbyist, not a professional — that means slower, with mistakes and learning curve factored in. If a project isn't worth the effort at the expected resale price, say so bluntly in the description. Include drying/curing time between coats. Don't assume everything will go perfectly on the first try.

IMPORTANT: Respond with ONLY a valid JSON object matching the requested schema. No markdown, no explanation, just JSON.`;

export interface DifficultyContext {
  difficulty: 'simple' | 'moderate' | 'full';
  label: string;
  summary: string;
  estimatedHours?: number;
  estimatedMaterialCost?: number;
  estimatedResalePrice?: number;
}

function buildDifficultyGuidance(ctx: DifficultyContext): string {
  const base = `\nThe user has chosen the "${ctx.difficulty}" approach: "${ctx.label}" — ${ctx.summary}\nTarget this difficulty level specifically. Use the following estimates as guidelines:\n- Estimated hours: ${ctx.estimatedHours ?? 'unknown'}\n- Estimated material cost: $${ctx.estimatedMaterialCost ?? 'unknown'}\n- Estimated resale price: $${ctx.estimatedResalePrice ?? 'unknown'}`;

  if (ctx.difficulty === 'simple') {
    return base + `\n\nFor this simple/beginner plan: preserve the original character of the piece. Clean, oil, minor touch-ups only. Minimal new materials. The piece should look cared-for but fundamentally unchanged.`;
  }

  if (ctx.difficulty === 'moderate') {
    return base + `\n\nFor this moderate/intermediate plan: go beyond just cleaning and re-staining. Include new hardware (knobs, pulls, hinges) where the piece has them. Choose a stain or finish that noticeably shifts the appearance. The result should look refreshed and modernized, clearly different from the simple option.`;
  }

  // full
  return base + `\n\nFor this full/advanced plan: this must be a DRAMATIC transformation — not just a nicer refinish. Think bold paint colors, two-tone treatments, structural modifications (adding new legs or a shelf, removing doors to create open shelving, converting function), creative techniques like color washing or stencil work, or a complete aesthetic reinvention. The result should be barely recognizable as the same piece. Do NOT just do a more thorough version of sanding and staining — go in a completely different creative direction.`;
}

function buildPrompt(listing: typeof listings.$inferSelect, difficultyCtx?: DifficultyContext): string {
  const parts = [
    `Generate a detailed refinishing plan for this furniture piece to maximize resale value.`,
    difficultyCtx ? buildDifficultyGuidance(difficultyCtx) : null,
    ``,
    `Piece details:`,
    `- Type: ${listing.furnitureType || 'Unknown'}`,
    `- Style: ${listing.furnitureStyle || 'Unknown'}`,
    `- Condition: ${listing.conditionScore || 'Unknown'}/10`,
    listing.conditionNotes ? `- Condition notes: ${listing.conditionNotes}` : null,
    `- Wood: ${listing.woodSpecies || 'Unknown'}`,
    listing.askingPrice ? `- Current asking price: $${listing.askingPrice}` : null,
    listing.estimatedValue ? `- Estimated current value: $${listing.estimatedValue}` : null,
    ``,
    `Return a JSON object with this exact structure:`,
    `{`,
    `  "style_recommendation": "recommended finish style (e.g., natural walnut stain, painted white with brass hardware, etc.)",`,
    `  "description": "1-2 sentence overview of the refinishing approach",`,
    `  "difficulty_level": "beginner | intermediate | advanced",`,
    `  "before_description": "what the piece looks like now based on condition",`,
    `  "after_description": "what it will look like after refinishing",`,
    `  "steps": [`,
    `    {`,
    `      "order": 1,`,
    `      "title": "step name",`,
    `      "description": "detailed instructions",`,
    `      "duration_minutes": 60,`,
    `      "products": [`,
    `        { "name": "specific product name", "brand": "brand", "quantity": 1, "unit": "qt", "estimated_price": 12.99 }`,
    `      ],`,
    `      "tips": ["helpful tips for this step"]`,
    `    }`,
    `  ],`,
    `  "estimated_total_hours": 8.5,`,
    `  "estimated_material_cost": 65.00,`,
    `  "estimated_resale_price": 350.00`,
    `}`,
    ``,
    `Requirements:`,
    `- Recommend actual products available at Amazon, Home Depot, or Lowe's`,
    `- Include a sanding step with specific grit progression where sanding is needed`,
    `- If stripping old finish, recommend a specific stripper product`,
    `- Include primer if painting, or wood conditioner if staining softwood`,
    `- Specify finish type: oil-based polyurethane, water-based poly, wax, chalk paint, milk paint, etc.`,
    `- For moderate/intermediate plans: include new hardware (knobs, pulls, hinges) where the piece has them`,
    `- For full/advanced plans: include any structural materials (wood, brackets, screws, new legs) and paint/creative supplies needed for the transformation`,
    `- Be realistic about time — include drying time between coats`,
    `- Estimated resale price should be realistic for the style and market`,
  ];

  return parts.filter(Boolean).join('\n');
}

export interface RagSourceRef {
  title: string;
  source: string;
  type: string;
}

export interface RefinishingResult {
  plan: RefinishingPlan;
  ragSourcesUsed: number;
  ragSourceTitles: string[];
  ragSources: RagSourceRef[];
}

export async function generateRefinishingPlan(listingId: number, projectId?: number, difficultyCtx?: DifficultyContext): Promise<RefinishingResult | null> {
  const listing = await db.select().from(listings).where(eq(listings.id, listingId)).then(r => r[0]);
  if (!listing) throw new Error(`Listing ${listingId} not found`);

  logger.info({ listingId, title: listing.title, difficulty: difficultyCtx?.difficulty }, 'Generating refinishing plan');

  let prompt = buildPrompt(listing, difficultyCtx);

  // Augment prompt with RAG context (past flips, product specs, technique guides)
  let ragChunksUsed = 0;
  const ragSourceTitles: string[] = [];
  let ragSources: RagSourceRef[] = [];
  try {
    const ragContext = await getFullContext({
      furnitureType: listing.furnitureType || 'furniture',
      woodSpecies: listing.woodSpecies,
      style: listing.furnitureStyle,
      conditionNotes: listing.conditionNotes,
    });
    if (ragContext.chunkCount > 0) {
      prompt += `\n\n${ragContext.text}\n\nUse the reference knowledge above to inform your product recommendations, time estimates, and resale price. Prefer products and techniques that have worked in documented past flips. If past flip data shows actual costs or hours, use those as calibration.`;
      ragChunksUsed = ragContext.chunkCount;
      ragSourceTitles.push(...ragContext.results.map((r) => r.title));
      ragSources = ragContext.sources.map(({ title, source, type }) => ({ title, source, type }));
      logger.debug({ listingId, ragChunks: ragContext.chunkCount }, 'RAG context injected into refinishing prompt');
    }
  } catch {
    // RAG not available — continue without it
  }

  const response = await generateText(prompt, SYSTEM_PROMPT, 3000);

  const jsonStr = extractJson(response);

  let plan: RefinishingPlan;
  try {
    const parsed = JSON.parse(jsonStr);
    plan = RefinishingPlanSchema.parse(parsed);
  } catch (err: any) {
    logger.error({ listingId, err: err.message, rawResponse: response.slice(0, 500) }, 'Failed to parse refinishing plan');
    return null;
  }

  // Map concept difficulty to plan difficulty level when generated from a concept
  if (difficultyCtx) {
    const conceptToPlanDifficulty: Record<string, 'beginner' | 'intermediate' | 'advanced'> = {
      simple: 'beginner', moderate: 'intermediate', full: 'advanced',
    };
    plan.difficulty_level = conceptToPlanDifficulty[difficultyCtx.difficulty] ?? plan.difficulty_level;
  }

  // Derive hours from step durations — the LLM's per-step breakdown is more
  // accurate than its stated total, and this ensures the concept card and plan
  // header always show the same number.
  const stepDerivedHours = Math.round(plan.steps.reduce((sum, s) => sum + s.duration_minutes, 0) / 60 * 10) / 10;

  // Store in DB — step-derived values are the source of truth
  const [stored] = await db.insert(refinishingPlans).values({
    listingId,
    projectId: projectId ?? null,
    styleRecommendation: plan.style_recommendation,
    description: plan.description,
    steps: JSON.stringify(plan.steps),
    estimatedHours: stepDerivedHours,
    estimatedMaterialCost: plan.estimated_material_cost,
    estimatedResalePrice: plan.estimated_resale_price,
    difficultyLevel: plan.difficulty_level,
    beforeDescription: plan.before_description,
    afterDescription: plan.after_description,
    rawResponse: response,
    ragSourcesUsed: ragChunksUsed,
    ragSourceTitles: ragSourceTitles.length > 0 ? JSON.stringify(ragSourceTitles) : null,
    ragSources: ragSources.length > 0 ? JSON.stringify(ragSources) : null,
  }).returning();

  // Sync all plan values back to concept card so the card is always consistent with the plan
  if (difficultyCtx) {
    await db.update(conceptRenders)
      .set({
        estimatedHours: stepDerivedHours,
        estimatedMaterialCost: plan.estimated_material_cost,
        estimatedResalePrice: plan.estimated_resale_price,
      })
      .where(and(
        eq(conceptRenders.listingId, listingId),
        eq(conceptRenders.difficulty, difficultyCtx.difficulty),
      )).catch(() => {}); // non-fatal
  }

  logger.info({
    planId: stored.id,
    style: plan.style_recommendation,
    difficulty: plan.difficulty_level,
    materialCost: plan.estimated_material_cost,
    hours: stepDerivedHours,
  }, 'Refinishing plan created');

  return { plan, ragSourcesUsed: ragChunksUsed, ragSourceTitles, ragSources };
}

export function parsePlanSteps(stepsJson: string): RefinishingStep[] {
  try {
    return z.array(StepSchema).parse(JSON.parse(stepsJson));
  } catch {
    return [];
  }
}
