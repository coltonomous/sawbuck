import { z } from 'zod';
import { db } from '../db/index.js';
import { listings, listingImages } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { analyzeWithVision, type ImageInput } from '../lib/claude.js';
import { getImageBase64 } from '../images/processor.js';

const FurnitureAnalysisSchema = z.object({
  furniture_type: z.string(),
  furniture_style: z.string(),
  condition_score: z.number().min(1).max(10),
  condition_notes: z.string(),
  wood_species: z.string().nullable(),
  wood_confidence: z.number().min(0).max(1),
  notable_features: z.array(z.string()),
  damage_items: z.array(z.string()),
  refinishing_potential: z.enum(['high', 'medium', 'low']),
  flip_recommendation: z.enum(['strong_buy', 'buy', 'maybe', 'pass']),
  refinishing_profit_verdict: z.string(),
});

export type FurnitureAnalysis = z.infer<typeof FurnitureAnalysisSchema>;

const SYSTEM_PROMPT = `You are a brutally honest furniture appraiser with 20+ years of experience in vintage, mid-century, and antique furniture. You do NOT sugarcoat. You do NOT give optimistic assessments to be nice.

Your job is to analyze photos of furniture listings and give the unfiltered truth about value, condition, and flipping potential. Call out every flaw you see. If the seller is hiding damage with camera angles, say so. If the piece is mass-produced junk dressed up as "vintage," say so. If the price is delusional, say so. A "pass" rating should be your default unless the numbers genuinely make sense. Only recommend "strong_buy" when the deal is obviously underpriced — not when it's merely "okay."

Grade condition like a strict teacher: 7+ means genuinely good, not "good enough." A 5 means real problems. Don't hand out 8s and 9s to be encouraging.

IMPORTANT: Respond with ONLY a valid JSON object matching the requested schema. No markdown, no explanation, just JSON.`;

const ANALYSIS_PROMPT = `Analyze this furniture piece from the listing photos. Return a JSON object with these fields:

{
  "furniture_type": "primary type (dresser, desk, chair, table, bookcase, cabinet, nightstand, bed_frame, sofa, sideboard, vanity, hutch, other)",
  "furniture_style": "design period/style (mid-century modern, victorian, art deco, farmhouse, industrial, contemporary, traditional, colonial, danish modern, etc.)",
  "condition_score": 1-10 number (10=like new, 7=good minor wear, 5=fair visible issues, 3=needs significant work, 1=heavily damaged),
  "condition_notes": "specific observations about condition — scratches, stains, missing hardware, structural issues, finish wear",
  "wood_species": "best guess (oak, walnut, maple, teak, pine, mahogany, cherry, etc.) or null if cannot determine",
  "wood_confidence": 0-1 confidence in wood identification,
  "notable_features": ["array of noteworthy features: dovetail joints, original hardware, unique design, solid wood construction, etc."],
  "damage_items": ["array of specific damage or wear: water ring on top, scratch on left side, missing drawer pull, etc."],
  "refinishing_potential": "high/medium/low — how much value could refinishing add",
  "flip_recommendation": "strong_buy/buy/maybe/pass — overall recommendation for buying to flip",
  "refinishing_profit_verdict": "1-3 sentence brutal verdict: will buying this piece, refinishing it, and reselling it actually turn a profit? Factor in realistic material costs ($30-150), time investment (hobbyist rate ~$25/hr), and what refinished pieces of this type/style actually sell for. If the margins are thin or negative, say so plainly. No sugarcoating."
}`;

export async function analyzeListing(listingId: number): Promise<FurnitureAnalysis | null> {
  const listing = await db.select().from(listings).where(eq(listings.id, listingId)).get();
  if (!listing) throw new Error(`Listing ${listingId} not found`);

  // Get downloaded/processed images
  const images = await db.select()
    .from(listingImages)
    .where(and(
      eq(listingImages.listingId, listingId),
      eq(listingImages.downloadStatus, 'downloaded'),
    ));

  if (images.length === 0) {
    console.warn(`[vision] No downloaded images for listing ${listingId}`);
    return null;
  }

  // Use up to 3 images — prefer resized, fall back to originals
  const toAnalyze = images.slice(0, 3);
  const imageInputs: ImageInput[] = [];

  for (const img of toAnalyze) {
    const imagePath = img.localPathResized || img.localPathOriginal;
    if (!imagePath) continue;

    try {
      const { base64, mediaType } = await getImageBase64(imagePath);
      imageInputs.push({ base64, mediaType: mediaType as ImageInput['mediaType'] });
    } catch (err: any) {
      console.warn(`[vision] Failed to read image ${imagePath}: ${err.message}`);
    }
  }

  if (imageInputs.length === 0) {
    console.warn(`[vision] No readable images for listing ${listingId}`);
    return null;
  }

  console.log(`[vision] Analyzing listing ${listingId} with ${imageInputs.length} images`);

  let prompt = ANALYSIS_PROMPT;
  if (listing.askingPrice) {
    prompt += `\n\nThe seller is asking $${listing.askingPrice} for this piece. Factor this into your refinishing_profit_verdict.`;
  }

  const response = await analyzeWithVision(imageInputs, prompt, SYSTEM_PROMPT);

  // Parse JSON from response — handle markdown code blocks if Claude wraps it
  let jsonStr = response.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  let analysis: FurnitureAnalysis;
  try {
    const parsed = JSON.parse(jsonStr);
    analysis = FurnitureAnalysisSchema.parse(parsed);
  } catch (err: any) {
    console.error(`[vision] Failed to parse Claude response for listing ${listingId}:`, err.message);
    console.error('[vision] Raw response:', response.slice(0, 500));
    return null;
  }

  // Update listing with analysis results
  await db.update(listings).set({
    furnitureType: analysis.furniture_type,
    furnitureStyle: analysis.furniture_style,
    conditionScore: analysis.condition_score,
    conditionNotes: analysis.condition_notes,
    woodSpecies: analysis.wood_species,
    woodConfidence: analysis.wood_confidence,
    analysisRaw: JSON.stringify(analysis),
    analyzedAt: new Date().toISOString(),
    status: 'analyzed',
  }).where(eq(listings.id, listingId));

  // Mark images as analyzed
  for (const img of toAnalyze) {
    await db.update(listingImages).set({
      analysisStatus: 'analyzed',
    }).where(eq(listingImages.id, img.id));
  }

  console.log(`[vision] Listing ${listingId}: ${analysis.furniture_type} (${analysis.furniture_style}), condition ${analysis.condition_score}/10, ${analysis.flip_recommendation}`);
  return analysis;
}
