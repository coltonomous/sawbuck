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
import { chunkGuide } from './guides.js';
import { agentConfig } from '../../agents/config.js';
import logger from '../../lib/logger.js';
import { createHash } from 'crypto';

const MAX_SOURCES_PER_RUN = 20;
const MAX_RETRIES = 5;

async function fetchPageText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Sawbuck/1.0; furniture research)',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      logger.warn({ url, status: response.status }, 'Worker: failed to fetch source');
      return null;
    }
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

export interface IngestedSource {
  title: string;
  url: string;
  type: string;
  chunks: number;
}

export async function processSourceQueue(): Promise<{ ingested: number; failed: number; sources: IngestedSource[] }> {
  await initStore();

  // Only process sources that haven't been ingested and haven't exceeded retry limit
  const pending = await db
    .select()
    .from(knowledgeSources)
    .where(isNull(knowledgeSources.lastIngestedAt))
    .limit(MAX_SOURCES_PER_RUN);

  // Filter out sources that have exceeded retry limit in JS (avoids complex drizzle query)
  const actionable = pending.filter((s) => (s.retryCount ?? 0) < MAX_RETRIES);

  if (actionable.length === 0) {
    return { ingested: 0, failed: 0, sources: [] };
  }

  logger.info({ count: actionable.length }, 'Worker: processing pending knowledge sources');

  let ingested = 0;
  let failed = 0;
  const ingestedSources: IngestedSource[] = [];

  for (const source of actionable) {
    const text = await fetchPageText(source.url);
    if (!text) {
      failed++;
      await db.update(knowledgeSources)
        .set({ lastFailedAt: new Date(), retryCount: (source.retryCount ?? 0) + 1 })
        .where(eq(knowledgeSources.id, source.id));
      if ((source.retryCount ?? 0) + 1 >= MAX_RETRIES) {
        logger.warn({ url: source.url, retries: MAX_RETRIES }, 'Worker: source exceeded retry limit, skipping permanently');
      }
      continue;
    }

    const hash = createHash('sha256').update(text).digest('hex');

    if (source.contentHash === hash) {
      await db.update(knowledgeSources)
        .set({ lastIngestedAt: new Date() })
        .where(eq(knowledgeSources.id, source.id));
      continue;
    }

    const textChunks = chunkGuide(text);
    if (textChunks.length === 0) {
      failed++;
      await db.update(knowledgeSources)
        .set({ lastFailedAt: new Date(), retryCount: (source.retryCount ?? 0) + 1 })
        .where(eq(knowledgeSources.id, source.id));
      continue;
    }

    const metadata = JSON.parse(source.metadata || '{}');
    const allChunks: Omit<KnowledgeChunk, 'id' | 'createdAt'>[] = textChunks.map((content: string, i: number) => ({
      type: source.type as 'product' | 'guide',
      source: source.url,
      title: textChunks.length === 1 ? source.title : `${source.title} (section ${i + 1})`,
      content,
      metadata,
    }));

    const embeddings = await embedBatch(allChunks.map((c) => c.content));
    const inserted = await upsertChunks(allChunks, embeddings);

    await db.update(knowledgeSources)
      .set({ lastIngestedAt: new Date(), contentHash: hash, lastFailedAt: null, retryCount: 0 })
      .where(eq(knowledgeSources.id, source.id));

    ingested += inserted;
    ingestedSources.push({ title: source.title, url: source.url, type: source.type, chunks: inserted });
    logger.info({ source: source.title, url: source.url, chunks: inserted }, 'Worker: source ingested');
  }

  if (ingested > 0) {
    const maxPerType = agentConfig.ragMaxChunksPerType;
    await evictExcess('product', maxPerType);
    await evictExcess('guide', maxPerType);
  }

  logger.info({ ingested, failed, sources: ingestedSources.map((s) => s.title) }, 'Worker: source queue processing complete');
  return { ingested, failed, sources: ingestedSources };
}
