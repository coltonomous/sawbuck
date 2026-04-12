/**
 * Ingest product spec data from manufacturer websites.
 *
 * Fetches product pages from the source manifest, extracts relevant
 * text (application instructions, dry times, coverage, compatibility),
 * chunks it, and stores in the knowledge base.
 *
 * Sources: Minwax, General Finishes, Varathane, Rust-Oleum, Citristrip, etc.
 */

import { embedBatch } from '../embeddings.js';
import { upsertChunks, clearChunks } from '../store.js';
import type { KnowledgeChunk } from '../store.js';
import logger from '../../lib/logger.js';

export interface ProductSource {
  name: string;
  brand: string;
  url: string;
  category: string;
}

/**
 * Fetch a page and extract its text content.
 * Uses a simple HTML-to-text approach — strips tags, normalizes whitespace.
 */
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
      logger.warn({ url, status: response.status }, 'Failed to fetch product page');
      return null;
    }

    const html = await response.text();
    return htmlToText(html);
  } catch (err) {
    logger.warn({ url, err: (err as Error).message }, 'Error fetching product page');
    return null;
  }
}

/**
 * Minimal HTML → text: strip tags, decode entities, collapse whitespace.
 * We don't need a full DOM parser for product pages — just the text content.
 */
function htmlToText(html: string): string {
  return html
    // Remove script/style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    // Convert block elements to newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

/**
 * Split text into chunks of roughly `maxTokens` words.
 * Splits on paragraph boundaries when possible.
 */
function chunkText(text: string, maxWords = 300): string[] {
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

  if (current.length > 0) {
    chunks.push(current.join('\n'));
  }

  return chunks;
}

/**
 * Ingest products from a list of sources.
 * Each source URL is fetched, text-extracted, chunked, and embedded.
 */
export async function ingestProducts(
  sources: ProductSource[],
): Promise<{ ingested: number; failed: number }> {
  if (sources.length === 0) {
    logger.info('No product sources to ingest');
    return { ingested: 0, failed: 0 };
  }

  logger.info({ count: sources.length }, 'Ingesting product sources');

  // Clear and re-ingest
  await clearChunks('product');

  const allChunks: Omit<KnowledgeChunk, 'id' | 'createdAt'>[] = [];
  let failed = 0;

  for (const source of sources) {
    const text = await fetchPageText(source.url);
    if (!text) {
      failed++;
      continue;
    }

    const textChunks = chunkText(text);
    if (textChunks.length === 0) {
      logger.warn({ source: source.name }, 'No usable text extracted');
      failed++;
      continue;
    }

    for (let i = 0; i < textChunks.length; i++) {
      const title =
        textChunks.length === 1
          ? `${source.brand} ${source.name}`
          : `${source.brand} ${source.name} (part ${i + 1})`;

      allChunks.push({
        type: 'product',
        source: source.url,
        title,
        content: textChunks[i],
        metadata: {
          brand: source.brand,
          product: source.name,
          category: source.category,
        },
      });
    }

    logger.debug({ product: source.name, chunks: textChunks.length }, 'Product chunked');
  }

  if (allChunks.length === 0) {
    return { ingested: 0, failed };
  }

  const embeddings = await embedBatch(allChunks.map((c) => c.content));
  const inserted = await upsertChunks(allChunks, embeddings);

  logger.info({ inserted, failed }, 'Product ingestion complete');
  return { ingested: inserted, failed };
}
