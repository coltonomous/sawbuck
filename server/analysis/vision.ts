import { z } from 'zod';
import { db, sqlite } from '../db/index.js';
import { listings, listingImages } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { analyzeWithVisionStructured, type ImageInput } from '../lib/claude.js';
import { getImageBase64 } from '../images/processor.js';
import { config } from '../lib/config.js';
import { getProjectContext } from '../rag/retrieval.js';
import logger from '../lib/logger.js';

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

// JSON Schema for Anthropic tool use — mirrors FurnitureAnalysisSchema above
const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    furniture_type: { type: 'string' },
    furniture_style: { type: 'string' },
    condition_score: { type: 'number', minimum: 1, maximum: 10 },
    condition_notes: { type: 'string' },
    wood_species: { type: 'string', nullable: true },
    wood_confidence: { type: 'number', minimum: 0, maximum: 1 },
    notable_features: { type: 'array', items: { type: 'string' } },
    damage_items: { type: 'array', items: { type: 'string' } },
    refinishing_potential: { type: 'string', enum: ['high', 'medium', 'low'] },
    flip_recommendation: { type: 'string', enum: ['strong_buy', 'buy', 'maybe', 'pass'] },
    refinishing_profit_verdict: { type: 'string' },
  },
  required: [
    'furniture_type', 'furniture_style', 'condition_score', 'condition_notes',
    'wood_species', 'wood_confidence', 'notable_features', 'damage_items',
    'refinishing_potential', 'flip_recommendation', 'refinishing_profit_verdict',
  ],
} as const;

export type FurnitureAnalysis = z.infer<typeof FurnitureAnalysisSchema>;

const SYSTEM_PROMPT = `You are a brutally honest furniture appraiser with 20+ years of experience in vintage, mid-century, and antique furniture. You do NOT sugarcoat. You do NOT give optimistic assessments to be nice.

Your job is to analyze photos of furniture listings and give the unfiltered truth about value, condition, and flipping potential. Call out every flaw you see. If the seller is hiding damage with camera angles, say so. If the piece is mass-produced junk dressed up as "vintage," say so. If the price is delusional, say so. A "pass" rating should be your default unless the numbers genuinely make sense. Only recommend "strong_buy" when the deal is obviously underpriced — not when it's merely "okay."

Grade condition like a strict teacher: 7+ means genuinely good, not "good enough." A 5 means real problems. Don't hand out 8s and 9s to be encouraging.

Use the submit_analysis tool to return your analysis.`;

const ANALYSIS_PROMPT = `Analyze this furniture piece from the listing photos. Return a JSON object with these fields:

{
  "furniture_type": "primary type (dresser, desk, chair, table, bookcase, cabinet, nightstand, bed_frame, sofa, sideboard, vanity, hutch, other)",
  "furniture_style": "design period/style (mid-century modern, victorian, art deco, farmhouse, industrial, contemporary, traditional, colonial, danish modern, japanese/tansu, chinese, korean, chinoiserie, campaign, shaker, mission/craftsman, regency, bohemian, coastal, brutalist, etc.)",
  "condition_score": 1-10 number (10=like new, 7=good minor wear, 5=fair visible issues, 3=needs significant work, 1=heavily damaged),
  "condition_notes": "specific observations about condition — scratches, stains, missing hardware, structural issues, finish wear",
  "wood_species": "best guess (oak, walnut, maple, teak, pine, mahogany, cherry, rosewood, elm, paulownia, cedar, cypress, bamboo, etc.) or null if cannot determine",
  "wood_confidence": 0-1 confidence in wood identification,
  "notable_features": ["array of noteworthy features: dovetail joints, original hardware, unique design, solid wood construction, etc."],
  "damage_items": ["array of specific damage or wear: water ring on top, scratch on left side, missing drawer pull, etc."],
  "refinishing_potential": "high/medium/low — how much value could refinishing add",
  "flip_recommendation": "strong_buy/buy/maybe/pass — overall recommendation for buying to flip",
  "refinishing_profit_verdict": "1-3 sentence brutal verdict: will buying this piece, refinishing it, and reselling it actually turn a profit? Consider BOTH full refinishing AND simple restoration (cleaning, minor touch-ups, hardware swap, light sanding) — if a quick restore gets 80% of the value for 20% of the effort, recommend that over a full refinish. Factor in realistic material costs ($30-150 for refinish, $10-30 for restore), time investment (hobbyist rate ~$25/hr), and what pieces of this type/style actually sell for in each condition. If the margins are thin or negative, say so plainly. No sugarcoating."
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
    const err = 'No downloaded images available for analysis';
    logger.warn({ listingId }, err);
    await db.update(listings).set({ analysisError: err }).where(eq(listings.id, listingId));
    return null;
  }

  // Use up to N images — prefer resized, fall back to originals
  const toAnalyze = images.slice(0, config.claude.maxAnalysisImages);
  const imageInputs: ImageInput[] = [];

  for (const img of toAnalyze) {
    const imagePath = img.localPathResized || img.localPathOriginal;
    if (!imagePath) continue;

    try {
      const { base64, mediaType } = await getImageBase64(imagePath);
      imageInputs.push({ base64, mediaType: mediaType as ImageInput['mediaType'] });
    } catch (err: any) {
      logger.warn({ imagePath, err: err.message }, 'Failed to read image');
    }
  }

  if (imageInputs.length === 0) {
    const err = 'All images failed to load — files may be corrupted or missing';
    logger.warn({ listingId }, err);
    await db.update(listings).set({ analysisError: err }).where(eq(listings.id, listingId));
    return null;
  }

  logger.info({ listingId, imageCount: imageInputs.length }, 'Analyzing listing');

  let prompt = ANALYSIS_PROMPT;
  if (listing.askingPrice) {
    prompt += `\n\nThe seller is asking $${listing.askingPrice} for this piece. Factor this into your refinishing_profit_verdict.`;
  }

  // Augment prompt with RAG context from past flips (if knowledge base is populated)
  let ragChunksUsed = 0;
  const ragSourceTitles: string[] = [];
  let ragSources: Array<{ title: string; source: string; type: string }> = [];
  if (listing.furnitureType || listing.title) {
    try {
      const ragContext = await getProjectContext(
        listing.furnitureType || listing.title,
        listing.woodSpecies,
        listing.furnitureStyle,
      );
      if (ragContext.chunkCount > 0) {
        prompt += `\n\n--- PAST FLIP DATA (from completed projects) ---\n${ragContext.text}\n--- END PAST FLIP DATA ---\n\nUse the past flip data above to ground your price estimates and profit verdict in real outcomes. If similar pieces have sold, reference those numbers.`;
        ragChunksUsed = ragContext.chunkCount;
        ragSourceTitles.push(...ragContext.results.map((r) => r.title));
        ragSources = ragContext.sources.map(({ title, source, type }) => ({ title, source, type }));
        logger.debug({ listingId, ragChunks: ragContext.chunkCount }, 'RAG context injected into vision prompt');
      }
    } catch {
      // RAG not available — continue without it
    }
  }

  let analysis: FurnitureAnalysis;
  try {
    analysis = await analyzeWithVisionStructured(
      imageInputs,
      prompt,
      ANALYSIS_JSON_SCHEMA,
      FurnitureAnalysisSchema,
      'submit_analysis',
      'Submit the structured furniture analysis',
      SYSTEM_PROMPT,
    );
  } catch (err: any) {
    const errorMsg = `Claude analysis failed: ${err.message}`;
    logger.error({ listingId, err: err.message }, 'Claude analysis failed');
    await db.update(listings).set({ analysisError: errorMsg }).where(eq(listings.id, listingId));
    return null;
  }

  // Update listing + mark images analyzed atomically
  sqlite.transaction(() => {
    db.update(listings).set({
      furnitureType: analysis.furniture_type,
      furnitureStyle: analysis.furniture_style,
      conditionScore: analysis.condition_score,
      conditionNotes: analysis.condition_notes,
      woodSpecies: analysis.wood_species,
      woodConfidence: analysis.wood_confidence,
      analysisRaw: JSON.stringify({
        ...analysis,
        rag_sources_used: ragChunksUsed,
        rag_source_titles: ragSourceTitles,
        rag_sources: ragSources,
      }),
      analyzedAt: new Date().toISOString(),
      status: 'analyzed',
      analysisError: null,
    }).where(eq(listings.id, listingId)).run();

    for (const img of toAnalyze) {
      db.update(listingImages).set({
        analysisStatus: 'analyzed',
      }).where(eq(listingImages.id, img.id)).run();
    }
  })();

  logger.info({
    listingId,
    type: analysis.furniture_type,
    style: analysis.furniture_style,
    condition: analysis.condition_score,
    recommendation: analysis.flip_recommendation,
  }, 'Listing analyzed');
  return analysis;
}
