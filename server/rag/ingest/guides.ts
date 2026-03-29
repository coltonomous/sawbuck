/**
 * Ingest refinishing technique guides from curated web sources.
 *
 * Fetches guide pages from the source manifest, extracts text,
 * chunks by section, and stores in the knowledge base. These give
 * Claude concrete technique references (grit progressions, dry times,
 * product compatibility) instead of relying on general training data.
 */

import { embedBatch } from '../embeddings.js';
import { upsertChunks, clearChunks } from '../store.js';
import type { KnowledgeChunk } from '../store.js';
import logger from '../../lib/logger.js';

export interface GuideSource {
  title: string;
  url: string;
  tags: string[];
}

/**
 * Fetch a page and extract text content.
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
      logger.warn({ url, status: response.status }, 'Failed to fetch guide page');
      return null;
    }

    const html = await response.text();
    return htmlToText(html);
  } catch (err) {
    logger.warn({ url, err: (err as Error).message }, 'Error fetching guide page');
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
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

/**
 * Chunk guide text by sections. Tries to split on heading-like patterns
 * first (lines starting with "Step", numbered lines, short all-caps lines),
 * falling back to word-count-based splitting.
 */
function chunkGuide(text: string, maxWords = 400): string[] {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  // Try to detect section boundaries
  const sectionBreaks: number[] = [0];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      /^(step\s+\d|#|\d+[\.\)]\s)/i.test(line) ||
      (line.length < 80 && line === line.toUpperCase() && line.length > 5)
    ) {
      sectionBreaks.push(i);
    }
  }

  // Build sections from detected breaks
  const sections: string[] = [];
  for (let i = 0; i < sectionBreaks.length; i++) {
    const start = sectionBreaks[i];
    const end = i + 1 < sectionBreaks.length ? sectionBreaks[i + 1] : lines.length;
    const section = lines.slice(start, end).join('\n');
    if (section.trim().length > 30) {
      sections.push(section.trim());
    }
  }

  // If section detection didn't work well, fall back to word-count chunking
  if (sections.length <= 1) {
    return chunkByWords(text, maxWords);
  }

  // Merge small sections, split large ones
  const result: string[] = [];
  let buffer = '';
  let bufferWords = 0;

  for (const section of sections) {
    const words = section.split(/\s+/).length;
    if (bufferWords + words > maxWords && buffer) {
      result.push(buffer);
      buffer = '';
      bufferWords = 0;
    }
    buffer += (buffer ? '\n' : '') + section;
    bufferWords += words;
  }
  if (buffer) result.push(buffer);

  return result;
}

function chunkByWords(text: string, maxWords: number): string[] {
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

/**
 * Ingest guides from a list of sources.
 */
export async function ingestGuides(
  sources: GuideSource[],
): Promise<{ ingested: number; failed: number }> {
  if (sources.length === 0) {
    logger.info('No guide sources to ingest');
    return { ingested: 0, failed: 0 };
  }

  logger.info({ count: sources.length }, 'Ingesting guide sources');

  clearChunks('guide');

  const allChunks: Omit<KnowledgeChunk, 'id' | 'createdAt'>[] = [];
  let failed = 0;

  for (const source of sources) {
    const text = await fetchPageText(source.url);
    if (!text) {
      failed++;
      continue;
    }

    const textChunks = chunkGuide(text);
    if (textChunks.length === 0) {
      logger.warn({ guide: source.title }, 'No usable text extracted');
      failed++;
      continue;
    }

    for (let i = 0; i < textChunks.length; i++) {
      const title =
        textChunks.length === 1
          ? source.title
          : `${source.title} (section ${i + 1})`;

      allChunks.push({
        type: 'guide',
        source: source.url,
        title,
        content: textChunks[i],
        metadata: {
          tags: source.tags,
          originalTitle: source.title,
        },
      });
    }

    logger.debug({ guide: source.title, chunks: textChunks.length }, 'Guide chunked');
  }

  if (allChunks.length === 0) {
    return { ingested: 0, failed };
  }

  const embeddings = await embedBatch(allChunks.map((c) => c.content));
  const inserted = upsertChunks(allChunks, embeddings);

  logger.info({ inserted, failed }, 'Guide ingestion complete');
  return { ingested: inserted, failed };
}
