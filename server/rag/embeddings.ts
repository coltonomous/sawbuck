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
 * Embed multiple texts in one call. Returns an array of Float32Array.
 * More efficient than calling embed() in a loop because the model
 * batches the tokenization.
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const ext = await getExtractor();

  const results: Float32Array[] = [];
  // Process one-at-a-time to keep memory predictable
  for (const text of texts) {
    const output = await ext(text, { pooling: 'mean', normalize: true });
    results.push(new Float32Array(output.data as Float64Array));
  }
  return results;
}

/** Warm up the model (call during startup if you want fast first queries). */
export async function warmup(): Promise<void> {
  await getExtractor();
}

export { DIMENSIONS };
