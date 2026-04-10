import { z } from 'zod';
import { analyzeWithVisionStructured } from '../../lib/claude.js';
import { isAvailable, getProjectContext } from '../../rag/retrieval.js';
import { agentConfig } from '../config.js';
import type { AgentState, TriagedCandidate, ScrapedCandidate } from '../state.js';
import logger from '../../lib/logger.js';

const BATCH_SIZE = 10; // listings per API call

const TRIAGE_SYSTEM_PROMPT = `You are a furniture flip triage assistant. Your job is to quickly assess whether Craigslist listings are wood furniture with flip potential.

You are looking for:
1. WOOD furniture specifically — solid wood, real wood species (oak, walnut, maple, cherry, mahogany, teak, pine, cedar, birch, rosewood, etc.)
2. Flip potential — could this be bought, cleaned up or refinished, and resold at a profit?

Items that are good candidates: dressers, desks, tables, chairs, bookshelves, cabinets, credenzas, hutches, nightstands, benches, bed frames (wood), vanities, sideboards.

Reject: particle board, IKEA flatpack, laminate, MDF-only construction, upholstered-only items (couches/sofas unless they have a wood frame worth salvaging), broken beyond reasonable repair, glass/metal-only furniture, appliances, non-furniture items.

Be generous at this stage — if there is a reasonable chance the item is wood furniture with flip potential, pass it through. The next stage does detailed analysis with photos.

You will receive a batch of listings. Assess each one independently.`;

export const TriageItemSchema = z.object({
  id: z.string(),
  is_wood_furniture: z.boolean(),
  has_flip_potential: z.boolean(),
  furniture_type: z.string(),
  reasoning: z.string(),
  confidence_score: z.number().min(0).max(1),
});

export const TriageBatchSchema = z.object({
  assessments: z.array(TriageItemSchema),
});

// Keep single-item schema for tests
export const TriageSchema = TriageItemSchema.omit({ id: true });
export type TriageOutput = z.infer<typeof TriageSchema>;

const TRIAGE_BATCH_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    assessments: {
      type: 'array' as const,
      description: 'One assessment per listing in the batch',
      items: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const, description: 'The listing ID from the input' },
          is_wood_furniture: { type: 'boolean' as const, description: 'Whether this appears to be wood furniture' },
          has_flip_potential: { type: 'boolean' as const, description: 'Whether this has potential to be flipped for profit' },
          furniture_type: { type: 'string' as const, description: 'Type of furniture (dresser, desk, table, etc.)' },
          reasoning: { type: 'string' as const, description: '1 sentence explanation' },
          confidence_score: { type: 'number' as const, description: 'Confidence from 0 to 1', minimum: 0, maximum: 1 },
        },
        required: ['id', 'is_wood_furniture', 'has_flip_potential', 'furniture_type', 'reasoning', 'confidence_score'] as const,
      },
    },
  },
  required: ['assessments'] as const,
};

async function buildSystemPrompt(): Promise<string> {
  let prompt = TRIAGE_SYSTEM_PROMPT;

  if (await isAvailable()) {
    try {
      const ctx = await getProjectContext('furniture flip woodworking');
      if (ctx.chunkCount > 0) {
        prompt += `\n\n## KNOWLEDGE BASE CONTEXT\nUse this data about past flips to inform your assessment of what types/species flip well:\n\n${ctx.text}`;
      }
    } catch (err) {
      logger.warn({ error: String(err) }, 'Triage: failed to retrieve RAG context');
    }
  }

  return prompt;
}

function buildBatchPrompt(candidates: ScrapedCandidate[]): string {
  const listings = candidates.map((c) => {
    const parts = [`ID: ${c.externalId}`, `Title: ${c.title}`];
    if (c.askingPrice != null) parts.push(`Price: $${c.askingPrice}`);
    if (c.location) parts.push(`Location: ${c.location}`);
    if (c.description) parts.push(`Description: ${c.description.slice(0, 300)}`);
    return parts.join('\n');
  });
  return `Assess each of these ${candidates.length} listings:\n\n${listings.join('\n---\n')}`;
}

export async function triageWithHaiku(state: AgentState): Promise<Partial<AgentState>> {
  const candidates = state.scrapedCandidates;
  const maxToTriage = Math.min(
    candidates.length,
    agentConfig.maxHaikuTriages - state.haikuTriaged,
  );

  if (maxToTriage <= 0) {
    logger.info('Triage: no candidates to triage or cap reached');
    return { triagedCandidates: [], passedTriage: [], haikuTriaged: state.haikuTriaged };
  }

  const systemPrompt = await buildSystemPrompt();
  const triaged: TriagedCandidate[] = [];
  const passed: TriagedCandidate[] = [];
  const errors: AgentState['errors'] = [];
  let count = 0;

  // Process in batches to reduce API calls (50 listings = 5 calls instead of 50)
  const toProcess = candidates.slice(0, maxToTriage);
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);

    try {
      const prompt = buildBatchPrompt(batch);
      const result = await analyzeWithVisionStructured(
        [],
        prompt,
        TRIAGE_BATCH_JSON_SCHEMA,
        TriageBatchSchema,
        'triage_batch',
        'Assess whether each listing is wood furniture with flip potential',
        systemPrompt,
        agentConfig.triageModel,
      );

      // Map results back to candidates by ID
      const resultMap = new Map(result.assessments.map((a) => [a.id, a]));

      for (const candidate of batch) {
        const assessment = resultMap.get(candidate.externalId);
        if (!assessment) {
          logger.warn({ externalId: candidate.externalId }, 'Triage: no assessment returned for listing');
          continue;
        }

        const triagedCandidate: TriagedCandidate = {
          ...candidate,
          triageResult: {
            isWoodFurniture: assessment.is_wood_furniture,
            hasFlipPotential: assessment.has_flip_potential,
            furnitureType: assessment.furniture_type,
            reasoning: assessment.reasoning,
            confidenceScore: assessment.confidence_score,
          },
        };
        triaged.push(triagedCandidate);

        if (
          assessment.is_wood_furniture &&
          assessment.has_flip_potential &&
          assessment.confidence_score >= agentConfig.triageConfidenceThreshold
        ) {
          passed.push(triagedCandidate);
        }

        count++;
      }
    } catch (err) {
      logger.warn({ batchSize: batch.length, error: String(err) }, 'Triage: batch failed');
      errors.push({ node: 'triage', message: `Batch of ${batch.length}: ${String(err)}`, timestamp: new Date().toISOString() });
    }
  }

  logger.info({ triaged: count, passed: passed.length, total: candidates.length, apiCalls: Math.ceil(toProcess.length / BATCH_SIZE) }, 'Triage node complete');

  return {
    triagedCandidates: triaged,
    passedTriage: passed,
    haikuTriaged: state.haikuTriaged + count,
    errors,
  };
}
