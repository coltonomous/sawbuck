/**
 * Background worker that processes pending knowledge sources from the DB.
 * Fetches, chunks, embeds, and upserts any source where lastIngestedAt
 * is NULL or the content has changed.
 */

import { db } from '../../db/index.js';
import { knowledgeSources } from '../../db/schema.js';
import { isNull, eq } from 'drizzle-orm';
import { embedBatch } from '../embeddings.js';
import { upsertChunks, initStore, evictExcess } from '../store.js';
import type { KnowledgeChunk } from '../store.js';
import { agentConfig } from '../../agents/config.js';
import logger from '../../lib/logger.js';
import { createHash } from 'crypto';

const MAX_SOURCES_PER_RUN = 20;

async function fetchPageText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Sawbuck/1.0; furniture research)',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    return htmlToText(html);
  } catch (err) {
    logger.warn({ url, err: (err as Error).message }, 'Worker: failed to fetch source');
    return null;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

function chunkText(text: string, maxWords = 350): string[] {
  const paragraphs = text.split('\n').filter((p) => p.trim().length > 20);
  const chunks: string[] = [];
  let current: string[] = [];
  let wordCount = 0;

  for (const para of paragraphs) {
    const words = para.split(/\s+/).length;
    if (wordCount + words > maxWords && current.length > 0) {
      chunks.push(current.join('\n'));
      current = [];
      wordCount = 0;
    }
    current.push(para.trim());
    wordCount += words;
  }
  if (current.length > 0) chunks.push(current.join('\n'));
  return chunks;
}

export interface IngestedSource {
  title: string;
  url: string;
  type: string;
  chunks: number;
}

export async function processSourceQueue(): Promise<{ ingested: number; failed: number; sources: IngestedSource[] }> {
  await initStore();

  // Fetch sources that haven't been ingested yet
  const pending = await db
    .select()
    .from(knowledgeSources)
    .where(isNull(knowledgeSources.lastIngestedAt))
    .limit(MAX_SOURCES_PER_RUN);

  if (pending.length === 0) {
    return { ingested: 0, failed: 0, sources: [] };
  }

  logger.info({ count: pending.length }, 'Worker: processing pending knowledge sources');

  let ingested = 0;
  let failed = 0;
  const ingestedSources: IngestedSource[] = [];

  for (const source of pending) {
    const text = await fetchPageText(source.url);
    if (!text) {
      failed++;
      continue;
    }

    const hash = createHash('sha256').update(text).digest('hex');

    // Skip if content hasn't changed (for re-runs)
    if (source.contentHash === hash) {
      await db.update(knowledgeSources)
        .set({ lastIngestedAt: new Date() })
        .where(eq(knowledgeSources.id, source.id));
      continue;
    }

    const textChunks = chunkText(text);
    if (textChunks.length === 0) {
      failed++;
      continue;
    }

    const metadata = JSON.parse(source.metadata || '{}');
    const allChunks: Omit<KnowledgeChunk, 'id' | 'createdAt'>[] = textChunks.map((content, i) => ({
      type: source.type as 'product' | 'guide',
      source: source.url,
      title: textChunks.length === 1 ? source.title : `${source.title} (part ${i + 1})`,
      content,
      metadata,
    }));

    const embeddings = await embedBatch(allChunks.map((c) => c.content));
    const inserted = await upsertChunks(allChunks, embeddings);

    await db.update(knowledgeSources)
      .set({ lastIngestedAt: new Date(), contentHash: hash })
      .where(eq(knowledgeSources.id, source.id));

    ingested += inserted;
    ingestedSources.push({ title: source.title, url: source.url, type: source.type, chunks: inserted });
    logger.info({ source: source.title, url: source.url, type: source.type, chunks: inserted }, 'Worker: source ingested');
  }

  // Enforce chunk limits after ingesting new sources
  if (ingested > 0) {
    const maxPerType = agentConfig.ragMaxChunksPerType;
    await evictExcess('product', maxPerType);
    await evictExcess('guide', maxPerType);
  }

  logger.info({ ingested, failed, sources: ingestedSources.map((s) => s.title) }, 'Worker: source queue processing complete');
  return { ingested, failed, sources: ingestedSources };
}
