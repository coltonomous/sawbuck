/**
 * High-level retrieval: turn a furniture query into relevant context
 * that can be injected into Claude prompts.
 *
 * This is the public API that vision.ts / refinishing.ts will eventually
 * call (behind a feature check) to augment their prompts.
 */

import { embed } from './embeddings.js';
import { search, chunkCount, type ChunkType, type SearchResult } from './store.js';
import logger from '../lib/logger.js';

export interface RetrievalContext {
  /** Formatted text block ready to inject into a prompt. */
  text: string;
  /** Number of chunks retrieved. */
  chunkCount: number;
  /** The raw search results, in case the caller wants to inspect them. */
  results: SearchResult[];
}

/**
 * Check whether the RAG knowledge base has any data.
 * Useful for feature-gating: skip retrieval if nothing has been ingested.
 */
export function isAvailable(): boolean {
  try {
    return chunkCount() > 0;
  } catch {
    // sqlite-vec not loaded or tables don't exist — RAG not set up
    return false;
  }
}

/**
 * Retrieve relevant past project outcomes for a furniture piece.
 *
 * Returns formatted context like:
 *   "A similar oak dresser was purchased for $80, refinished in 12 hours
 *    with $95 in materials, and sold for $340 (ROI: 134%)."
 */
export async function getProjectContext(
  furnitureType: string,
  woodSpecies?: string | null,
  style?: string | null,
  k = 3,
): Promise<RetrievalContext> {
  const query = buildQuery(furnitureType, woodSpecies, style);
  return retrieveFormatted(query, k, 'project', formatProjectChunk);
}

/**
 * Retrieve relevant product specs for a refinishing task.
 *
 * Returns formatted context like:
 *   "Citristrip Paint & Varnish Stripping Gel: apply thick coat, wait
 *    30 min to 24 hrs, covers 15 sq ft per quart. Works on wood, metal,
 *    masonry. Low odor, indoor safe."
 */
export async function getProductContext(
  furnitureType: string,
  woodSpecies?: string | null,
  condition?: string | null,
  k = 5,
): Promise<RetrievalContext> {
  // Build a task-oriented query rather than just the item description
  const parts = [furnitureType];
  if (woodSpecies) parts.push(woodSpecies);
  if (condition) parts.push(`condition: ${condition}`);
  parts.push('refinishing products materials');

  const query = parts.join(' ');
  return retrieveFormatted(query, k, 'product', formatProductChunk);
}

/**
 * Retrieve relevant technique guides for a refinishing task.
 */
export async function getGuideContext(
  furnitureType: string,
  woodSpecies?: string | null,
  taskDescription?: string | null,
  k = 3,
): Promise<RetrievalContext> {
  const parts = [furnitureType];
  if (woodSpecies) parts.push(woodSpecies);
  if (taskDescription) parts.push(taskDescription);
  parts.push('refinishing technique how to');

  const query = parts.join(' ');
  return retrieveFormatted(query, k, 'guide', formatGuideChunk);
}

/**
 * Retrieve all relevant context (projects + products + guides) in one call.
 * Returns a combined context block ready for prompt injection.
 */
export async function getFullContext(params: {
  furnitureType: string;
  woodSpecies?: string | null;
  style?: string | null;
  conditionNotes?: string | null;
}): Promise<RetrievalContext> {
  const { furnitureType, woodSpecies, style, conditionNotes } = params;

  const [projects, products, guides] = await Promise.all([
    getProjectContext(furnitureType, woodSpecies, style, 3),
    getProductContext(furnitureType, woodSpecies, conditionNotes, 4),
    getGuideContext(furnitureType, woodSpecies, conditionNotes, 3),
  ]);

  const sections: string[] = [];
  const allResults: SearchResult[] = [];

  if (projects.chunkCount > 0) {
    sections.push(`## Past Flip Outcomes\n${projects.text}`);
    allResults.push(...projects.results);
  }
  if (products.chunkCount > 0) {
    sections.push(`## Relevant Product Specs\n${products.text}`);
    allResults.push(...products.results);
  }
  if (guides.chunkCount > 0) {
    sections.push(`## Refinishing Techniques\n${guides.text}`);
    allResults.push(...guides.results);
  }

  const text = sections.length > 0
    ? `--- REFERENCE KNOWLEDGE (retrieved from knowledge base) ---\n\n${sections.join('\n\n')}\n\n--- END REFERENCE KNOWLEDGE ---`
    : '';

  logger.debug({
    projects: projects.chunkCount,
    products: products.chunkCount,
    guides: guides.chunkCount,
  }, 'RAG context retrieved');

  return {
    text,
    chunkCount: allResults.length,
    results: allResults,
  };
}

// ─── Internal helpers ───────────────────────────────────────────────

function buildQuery(
  furnitureType: string,
  woodSpecies?: string | null,
  style?: string | null,
): string {
  const parts = [furnitureType];
  if (woodSpecies) parts.push(woodSpecies);
  if (style) parts.push(style);
  return parts.join(' ');
}

async function retrieveFormatted(
  query: string,
  k: number,
  type: ChunkType,
  formatter: (r: SearchResult) => string,
): Promise<RetrievalContext> {
  const queryVec = await embed(query);
  const results = search(queryVec, k, type);

  // Filter out low-relevance results (distance > 1.2 for normalized cosine)
  const relevant = results.filter((r) => r.distance < 1.2);

  const text = relevant.map(formatter).join('\n\n');

  return { text, chunkCount: relevant.length, results: relevant };
}

function formatProjectChunk(r: SearchResult): string {
  const m = r.metadata as Record<string, unknown>;
  const parts = [`- **${r.title}**`];
  if (m.purchasePrice) parts.push(`Purchased for $${m.purchasePrice}`);
  if (m.totalMaterialCost) parts.push(`materials cost $${m.totalMaterialCost}`);
  if (m.hoursInvested) parts.push(`${m.hoursInvested} hours invested`);
  if (m.soldPrice) parts.push(`sold for $${m.soldPrice}`);
  if (m.roiPercentage) parts.push(`ROI: ${m.roiPercentage}%`);
  if (m.daysToFlip) parts.push(`${m.daysToFlip} days to flip`);
  return parts.join(', ') + '.';
}

function formatProductChunk(r: SearchResult): string {
  return `- **${r.title}**: ${r.content}`;
}

function formatGuideChunk(r: SearchResult): string {
  return `- **${r.title}** (${r.source}): ${r.content}`;
}
