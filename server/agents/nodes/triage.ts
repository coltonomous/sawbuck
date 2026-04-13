import { z } from 'zod';
import { analyzeWithVisionStructured, type ImageInput } from '../../lib/bedrock.js';
import { isAvailable, getProjectContext } from '../../rag/retrieval.js';
import { agentConfig } from '../config.js';
import { reportProgress } from '../progress.js';
import type { AgentState, TriagedCandidate, ScrapedCandidate } from '../state.js';
import logger from '../../lib/logger.js';

const BATCH_SIZE = 5;

// ─── Pass 1: Text-only batch triage (cheap model) ─────────────────

const TRIAGE_SYSTEM_PROMPT = `You are a furniture flip triage assistant. Your job is to quickly assess whether Craigslist listings are wood furniture with flip potential.

You are looking for:
1. WOOD furniture specifically — solid wood, real wood species (oak, walnut, maple, cherry, mahogany, teak, pine, cedar, birch, rosewood, etc.)
2. Flip potential — could this be bought, cleaned up or refinished, and resold at a profit?

Items that are good candidates: dressers, desks, tables, chairs, bookshelves, cabinets, credenzas, hutches, nightstands, benches, bed frames (wood), vanities, sideboards.

Reject: particle board, IKEA flatpack, laminate, MDF-only construction, upholstered-only items (couches/sofas unless they have a wood frame worth salvaging), broken beyond reasonable repair, glass/metal-only furniture, lamps/lighting, mirrors without wood frames, appliances, electronics, non-furniture items, crystal, brass-only, marble-only, or any item where wood is not the primary material.

When in doubt about material, look at the title and description carefully. "Metal desk", "glass table", "crystal lamp" = reject. Only pass items where wood is clearly the primary structural material.

You will receive a batch of listings. Assess each one independently.`;

export const TriageItemSchema = z.object({
  id: z.string(),
  is_wood_furniture: z.boolean().nullable().transform((v) => v ?? false),
  has_flip_potential: z.boolean().nullable().transform((v) => v ?? false),
  furniture_type: z.string().nullable().transform((v) => v ?? 'unknown'),
  reasoning: z.string().nullable().transform((v) => v ?? ''),
  confidence_score: z.number().min(0).max(1).nullable().transform((v) => v ?? 0),
});

export const TriageBatchSchema = z.object({
  assessments: z.array(TriageItemSchema),
});

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

// ─── Pass 2: Visual confirmation (vision model, one at a time) ────

const VISUAL_CHECK_SYSTEM = `You are a quick visual checker for a furniture triage pipeline. You receive one photo from a Craigslist listing that was flagged as potential wood furniture by a text-only classifier.

Your job: look at the photo and confirm or reject. Is this ACTUALLY wood furniture worth flipping?

Answer with a JSON object. Be strict — if you can see it's not wood, or not furniture, or clearly not worth refinishing, reject it.`;

const VisualCheckSchema = z.object({
  confirmed: z.boolean().nullable().transform((v) => v ?? false),
  reasoning: z.string().default(''),
});

const VISUAL_CHECK_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    confirmed: { type: 'boolean' as const, description: 'true if this is wood furniture worth evaluating further' },
    reasoning: { type: 'string' as const, description: '1 sentence explanation' },
  },
  required: ['confirmed', 'reasoning'] as const,
};

// ─── Main triage function ─────────────────────────────────────────

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

async function fetchImageAsBase64(url: string): Promise<ImageInput | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'Accept': 'image/*' },
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) return null;

    const base64 = buffer.toString('base64');
    // Detect format from first bytes
    let mediaType: ImageInput['mediaType'] = 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50) mediaType = 'image/png';
    else if (buffer[0] === 0x52 && buffer[1] === 0x49) mediaType = 'image/webp';
    else if (buffer[0] === 0x47 && buffer[1] === 0x49) mediaType = 'image/gif';

    return { base64, mediaType };
  } catch {
    return null;
  }
}

export async function triageCandidates(state: AgentState): Promise<Partial<AgentState>> {
  const candidates = state.scrapedCandidates;
  const triageCounts = state.triageCount;
  const maxPerPlatform = agentConfig.maxTriages;

  // Group candidates by platform and apply per-platform budget
  const byPlatform = new Map<string, ScrapedCandidate[]>();
  for (const c of candidates) {
    const group = byPlatform.get(c.platform) ?? [];
    group.push(c);
    byPlatform.set(c.platform, group);
  }

  const toProcess: ScrapedCandidate[] = [];
  for (const [platform, platformCandidates] of byPlatform) {
    const used = triageCounts[platform] ?? 0;
    const remaining = Math.max(0, maxPerPlatform - used);
    if (remaining > 0) {
      toProcess.push(...platformCandidates.slice(0, remaining));
    } else {
      logger.info({ platform, used }, 'Triage: platform budget exhausted');
    }
  }

  if (toProcess.length === 0) {
    logger.info('Triage: no candidates to triage or all platform caps reached');
    return { triagedCandidates: [], passedTriage: [], triageCount: triageCounts };
  }

  const systemPrompt = await buildSystemPrompt();
  const triaged: TriagedCandidate[] = [];
  const textPassed: Array<{ candidate: ScrapedCandidate; triage: TriagedCandidate }> = [];
  const errors: AgentState['errors'] = [];
  let count = 0;

  // ── Pass 1: Text-only batch classification ──────────────────────
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
        count++;

        if (
          assessment.is_wood_furniture &&
          assessment.has_flip_potential &&
          assessment.confidence_score >= agentConfig.triageConfidenceThreshold
        ) {
          textPassed.push({ candidate, triage: triagedCandidate });
        }
      }
    } catch (err) {
      logger.warn({ batchSize: batch.length, error: String(err) }, 'Triage pass 1: batch failed');
      errors.push({ node: 'triage', message: `Pass 1 batch of ${batch.length}: ${String(err)}`, timestamp: new Date().toISOString() });
    }
  }

  logger.info({ triaged: count, textPassed: textPassed.length }, 'Triage pass 1 complete');

  // Pass 2 (visual confirmation) removed — the text-only classifier at ≥0.6
  // confidence is accurate enough. False positives are caught by the full
  // evaluate node which does proper vision analysis anyway.
  const passed = textPassed.map(({ triage }) => triage);

  logger.info({
    triaged: count,
    passed: passed.length,
    apiCalls: Math.ceil(toProcess.length / BATCH_SIZE),
  }, 'Triage node complete');

  reportProgress(state.runId, { triaged: triaged.length, passedTriage: passed.length });

  // Update per-platform triage counts
  const updatedCounts = { ...triageCounts };
  for (const t of triaged) {
    updatedCounts[t.platform] = (updatedCounts[t.platform] ?? 0) + 1;
  }

  return {
    triagedCandidates: triaged,
    passedTriage: passed,
    triageCount: updatedCounts,
    errors,
  };
}
