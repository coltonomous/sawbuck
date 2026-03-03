import { z } from 'zod';
import { db } from '../db/index.js';
import { listings, refinishingPlans } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { generateText } from '../lib/claude.js';

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

function buildPrompt(listing: typeof listings.$inferSelect): string {
  const parts = [
    `Generate a detailed refinishing plan for this furniture piece to maximize resale value.`,
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
    `- Include a sanding step with specific grit progression`,
    `- If stripping old finish, recommend a specific stripper product`,
    `- Include primer if painting, or wood conditioner if staining softwood`,
    `- Specify finish type: oil-based polyurethane, water-based poly, wax, etc.`,
    `- Include hardware recommendations if replacing (knobs, pulls, hinges)`,
    `- Be realistic about time — include drying time between coats`,
    `- Estimated resale price should be realistic for the style and market`,
  ];

  return parts.filter(Boolean).join('\n');
}

export async function generateRefinishingPlan(listingId: number, projectId?: number): Promise<RefinishingPlan | null> {
  const listing = await db.select().from(listings).where(eq(listings.id, listingId)).get();
  if (!listing) throw new Error(`Listing ${listingId} not found`);

  console.log(`[refinishing] Generating plan for listing ${listingId}: ${listing.title}`);

  const prompt = buildPrompt(listing);
  const response = await generateText(prompt, SYSTEM_PROMPT, 3000);

  // Parse JSON — handle markdown wrapping
  let jsonStr = response.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  let plan: RefinishingPlan;
  try {
    const parsed = JSON.parse(jsonStr);
    plan = RefinishingPlanSchema.parse(parsed);
  } catch (err: any) {
    console.error(`[refinishing] Failed to parse plan for listing ${listingId}:`, err.message);
    console.error('[refinishing] Raw response:', response.slice(0, 500));
    return null;
  }

  // Store in DB
  const [stored] = await db.insert(refinishingPlans).values({
    listingId,
    projectId: projectId ?? null,
    styleRecommendation: plan.style_recommendation,
    description: plan.description,
    steps: JSON.stringify(plan.steps),
    estimatedHours: plan.estimated_total_hours,
    estimatedMaterialCost: plan.estimated_material_cost,
    estimatedResalePrice: plan.estimated_resale_price,
    difficultyLevel: plan.difficulty_level,
    beforeDescription: plan.before_description,
    afterDescription: plan.after_description,
    rawResponse: response,
  }).returning();

  console.log(`[refinishing] Plan ${stored.id} created: ${plan.style_recommendation} (${plan.difficulty_level}), ~$${plan.estimated_material_cost} materials, ~${plan.estimated_total_hours}h`);

  return plan;
}

export function parsePlanSteps(stepsJson: string): RefinishingStep[] {
  try {
    return z.array(StepSchema).parse(JSON.parse(stepsJson));
  } catch {
    return [];
  }
}
