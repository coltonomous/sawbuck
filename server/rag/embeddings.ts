/**
 * Local embedding via @xenova/transformers (all-MiniLM-L6-v2).
 *
 * Runs entirely on-device — no API key, no cost. The model (~80 MB) is
 * downloaded once on first use and cached in ~/.cache/huggingface.
 *
 * Produces 384-dimensional float32 vectors suitable for cosine similarity.
 */

import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import logger from '../lib/logger.js';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DIMENSIONS = 384;

let extractor: FeatureExtractionPipeline | null = null;
let loadingPromise: Promise<FeatureExtractionPipeline> | null = null;

/** Lazily load the embedding model (first call downloads ~80 MB). */
async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;
  if (loadingPromise) return loadingPromise;

  loadingPromise = pipeline('feature-extraction', MODEL_ID, {
    quantized: true, // use int8 quantized version — faster, smaller
  });

  loadingPromise
    .then((ext) => {
      extractor = ext;
      logger.info({ model: MODEL_ID }, 'Embedding model loaded');
    })
    .catch((err) => {
      loadingPromise = null;
      logger.error({ err: (err as Error).message }, 'Failed to load embedding model');
    });

  return loadingPromise;
}

/**
 * Embed a single text string → Float32Array of length 384.
 * Uses mean pooling + L2 normalization (suitable for cosine similarity).
 */
export async function embed(text: string): Promise<Float32Array> {
  const ext = await getExtractor();
  const output = await ext(text, { pooling: 'mean', normalize: true });
  return new Float32Array(output.data as Float64Array);
}

/**
 * Embed multiple texts in batches. Returns an array of Float32Array.
 * Processes in batches of 16 to balance throughput and memory.
 */
const EMBED_BATCH_SIZE = 16;

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const ext = await getExtractor();

  const results: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const output = await ext(batch, { pooling: 'mean', normalize: true });
    // output.data is a flat Float64Array of all embeddings concatenated
    for (let j = 0; j < batch.length; j++) {
      const start = j * DIMENSIONS;
      results.push(new Float32Array(output.data.slice(start, start + DIMENSIONS) as Float64Array));
    }
  }
  return results;
}

/** Warm up the model (call during startup if you want fast first queries). */
export async function warmup(): Promise<void> {
  await getExtractor();
}

export { DIMENSIONS };
