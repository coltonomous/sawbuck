/**
 * Ingest completed flip projects into the knowledge base.
 *
 * Reads all projects with status='sold' that have actual financial data,
 * joins with the listing's furniture metadata, and creates one knowledge
 * chunk per completed flip. These chunks ground future appraisals and
 * refinishing plans in real outcomes.
 */

import { db } from '../../db/index.js';
import { projects, listings, materials } from '../../db/schema.js';
import { eq, and, isNotNull } from 'drizzle-orm';
import { embed, embedBatch } from '../embeddings.js';
import { upsertChunk, upsertChunks, clearChunks } from '../store.js';
import type { KnowledgeChunk } from '../store.js';
import logger from '../../lib/logger.js';

interface CompletedFlip {
  // Project
  projectId: number;
  projectName: string;
  purchasePrice: number;
  totalMaterialCost: number | null;
  hoursInvested: number | null;
  soldPrice: number | null;
  profit: number | null;
  roiPercentage: number | null;
  purchaseDate: string | null;
  soldDate: string | null;
  // Listing
  furnitureType: string | null;
  furnitureStyle: string | null;
  woodSpecies: string | null;
  conditionScore: number | null;
  conditionNotes: string | null;
  askingPrice: number | null;
}

/**
 * Pull all sold projects with financial data from the main DB.
 */
function getCompletedFlips(): CompletedFlip[] {
  const rows = db
    .select({
      projectId: projects.id,
      projectName: projects.name,
      purchasePrice: projects.purchasePrice,
      totalMaterialCost: projects.totalMaterialCost,
      hoursInvested: projects.hoursInvested,
      soldPrice: projects.soldPrice,
      profit: projects.profit,
      roiPercentage: projects.roiPercentage,
      purchaseDate: projects.purchaseDate,
      soldDate: projects.soldDate,
      furnitureType: listings.furnitureType,
      furnitureStyle: listings.furnitureStyle,
      woodSpecies: listings.woodSpecies,
      conditionScore: listings.conditionScore,
      conditionNotes: listings.conditionNotes,
      askingPrice: listings.askingPrice,
    })
    .from(projects)
    .innerJoin(listings, eq(projects.listingId, listings.id))
    .where(
      and(
        eq(projects.status, 'sold'),
        isNotNull(projects.soldPrice),
      ),
    )
    .all();

  return rows;
}

/**
 * Get materials used for a project (if a refinishing plan was generated).
 */
function getProjectMaterials(projectId: number): string[] {
  const rows = db
    .select({ productName: materials.productName, brand: materials.brand })
    .from(materials)
    .where(eq(materials.projectId, projectId))
    .all();

  return rows.map((r) =>
    r.brand ? `${r.brand} ${r.productName}` : r.productName,
  );
}

/**
 * Build a natural-language chunk from a completed flip.
 */
function flipToChunk(flip: CompletedFlip, materialsUsed: string[]): Omit<KnowledgeChunk, 'id' | 'createdAt'> {
  const daysToFlip =
    flip.purchaseDate && flip.soldDate
      ? Math.round(
          (new Date(flip.soldDate).getTime() - new Date(flip.purchaseDate).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : null;

  // Build human-readable content for embedding
  const lines: string[] = [];
  lines.push(`Completed flip: ${flip.furnitureType || 'furniture'}`);
  if (flip.furnitureStyle) lines.push(`Style: ${flip.furnitureStyle}`);
  if (flip.woodSpecies) lines.push(`Wood: ${flip.woodSpecies}`);
  if (flip.conditionScore) lines.push(`Condition at purchase: ${flip.conditionScore}/10`);
  if (flip.conditionNotes) lines.push(`Condition notes: ${flip.conditionNotes}`);
  lines.push(`Purchase price: $${flip.purchasePrice}`);
  if (flip.totalMaterialCost) lines.push(`Material cost: $${flip.totalMaterialCost}`);
  if (flip.hoursInvested) lines.push(`Hours invested: ${flip.hoursInvested}`);
  if (flip.soldPrice) lines.push(`Sold for: $${flip.soldPrice}`);
  if (flip.profit != null) lines.push(`Profit: $${flip.profit}`);
  if (flip.roiPercentage != null) lines.push(`ROI: ${flip.roiPercentage}%`);
  if (daysToFlip != null) lines.push(`Days to flip: ${daysToFlip}`);
  if (materialsUsed.length > 0) {
    lines.push(`Materials used: ${materialsUsed.join(', ')}`);
  }

  // Title is what we search/display — make it descriptive
  const title = [
    flip.furnitureStyle,
    flip.woodSpecies,
    flip.furnitureType || 'furniture',
    'flip',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    type: 'project',
    source: `project:${flip.projectId}`,
    title,
    content: lines.join('. '),
    metadata: {
      projectId: flip.projectId,
      furnitureType: flip.furnitureType,
      furnitureStyle: flip.furnitureStyle,
      woodSpecies: flip.woodSpecies,
      conditionScore: flip.conditionScore,
      purchasePrice: flip.purchasePrice,
      totalMaterialCost: flip.totalMaterialCost,
      hoursInvested: flip.hoursInvested,
      soldPrice: flip.soldPrice,
      profit: flip.profit,
      roiPercentage: flip.roiPercentage,
      daysToFlip,
    },
  };
}

/**
 * Ingest a single project into the knowledge base. Called automatically
 * when a project transitions to 'sold'. Fire-and-forget — errors are
 * logged but don't propagate.
 */
export async function tryIngestProject(projectId: number): Promise<void> {
  try {
    const flip = db
      .select({
        projectId: projects.id,
        projectName: projects.name,
        purchasePrice: projects.purchasePrice,
        totalMaterialCost: projects.totalMaterialCost,
        hoursInvested: projects.hoursInvested,
        soldPrice: projects.soldPrice,
        profit: projects.profit,
        roiPercentage: projects.roiPercentage,
        purchaseDate: projects.purchaseDate,
        soldDate: projects.soldDate,
        furnitureType: listings.furnitureType,
        furnitureStyle: listings.furnitureStyle,
        woodSpecies: listings.woodSpecies,
        conditionScore: listings.conditionScore,
        conditionNotes: listings.conditionNotes,
        askingPrice: listings.askingPrice,
      })
      .from(projects)
      .innerJoin(listings, eq(projects.listingId, listings.id))
      .where(eq(projects.id, projectId))
      .get();

    if (!flip || !flip.soldPrice) return;

    const mats = getProjectMaterials(projectId);
    const chunk = flipToChunk(flip, mats);
    const embedding = await embed(chunk.content);
    const id = upsertChunk(chunk, embedding);

    if (id) {
      logger.info({ projectId, chunkId: id }, 'Project ingested into knowledge base');
    }
  } catch (err) {
    logger.warn({ projectId, err: (err as Error).message }, 'Failed to ingest project into RAG (non-fatal)');
  }
}

/**
 * Ingest all completed flips into the knowledge base.
 * Clears existing project chunks first to avoid stale data, then
 * re-ingests everything. Safe to call repeatedly.
 */
export async function ingestProjects(): Promise<{ ingested: number; skipped: number }> {
  const flips = getCompletedFlips();
  if (flips.length === 0) {
    logger.info('No completed flips to ingest');
    return { ingested: 0, skipped: 0 };
  }

  logger.info({ count: flips.length }, 'Ingesting completed flips');

  // Clear stale project chunks and re-ingest
  clearChunks('project');

  const chunks = flips.map((flip) => {
    const mats = getProjectMaterials(flip.projectId);
    return flipToChunk(flip, mats);
  });

  const texts = chunks.map((c) => c.content);
  const embeddings = await embedBatch(texts);
  const inserted = upsertChunks(chunks, embeddings);

  logger.info({ inserted, total: flips.length }, 'Project ingestion complete');
  return { ingested: inserted, skipped: flips.length - inserted };
}

// Exported for testing
export { flipToChunk, getProjectMaterials, type CompletedFlip };
