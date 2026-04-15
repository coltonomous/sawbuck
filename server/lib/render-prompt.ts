/**
 * Shared concept render prompt logic.
 * Used by both the agent pipeline (plan-options.ts) and the
 * on-demand render route (listings.ts) so they stay in sync.
 */

const PAINT_RE = /paint|chalk|milk|lacquer|enamel/i;

function isPaintFinish(finishType: string, summary: string): boolean {
  return PAINT_RE.test(finishType) || PAINT_RE.test(summary);
}

/**
 * Build an editing instruction for Kontext (image-editing model).
 * These prompts tell the model what to CHANGE about the reference photo.
 */
export function buildEditPrompt(opts: {
  furnitureType: string;
  finishType: string;
  label: string;
  summary: string;
}): string {
  const { furnitureType, finishType, label, summary } = opts;

  if (isPaintFinish(finishType, summary)) {
    return `Refinish this ${furnitureType} with a ${label} finish. Paint the entire wood surface — ${summary}. No bare wood visible. The paint color, texture, and sheen should be clearly visible. Keep everything else the same — same shape, same hardware, same background.`;
  }

  return `Refinish this ${furnitureType} with a ${label} finish. ${summary}. Change the surface color, tone, and sheen to show the ${finishType} treatment clearly. The wood grain and texture should reflect the new finish. Keep everything else the same — same shape, same hardware, same background.`;
}

/**
 * Build a generation prompt for text-to-image fallback (no reference photo).
 */
export function buildRenderPrompt(opts: {
  furnitureType: string;
  finishType: string;
  label: string;
  summary: string;
  afterDescription?: string;
  styleRecommendation?: string;
}): string {
  const { furnitureType, finishType, label, summary } = opts;
  const afterDesc = opts.afterDescription ?? summary;
  const style = opts.styleRecommendation ?? label;

  if (isPaintFinish(finishType, summary)) {
    return `A ${furnitureType} with a ${label} finish. ${summary}. The entire surface is covered in ${label} — no bare wood visible. The paint color, sheen, and texture must dominate the image. Style: ${style}. Photorealistic product photography, studio lighting with specular highlights to show the paint finish.`;
  }

  return `A ${furnitureType} with a ${label} finish. ${summary}. After: ${afterDesc}. The surface color, sheen, and texture show the ${finishType} finish in sharp detail (grain, tone, reflectivity). Style: ${style}. Photorealistic product photography, studio lighting angled to highlight the surface texture and finish quality.`;
}

/**
 * Build the complete fal.ai request (model + input) for a concept render.
 * Uses Kontext editing when a reference image is available, text-to-image otherwise.
 */
export function buildConceptRenderRequest(opts: {
  concept: { finishType: string; label: string; summary: string };
  furnitureType: string;
  referenceImageUrl: string | null;
  conceptEditModel: string;
  textToImageModel: string;
  imageSize: number;
  afterDescription?: string;
  styleRecommendation?: string;
}): { model: string; input: Record<string, unknown> } {
  const promptOpts = {
    furnitureType: opts.furnitureType,
    finishType: opts.concept.finishType,
    label: opts.concept.label,
    summary: opts.concept.summary,
  };

  if (opts.referenceImageUrl) {
    return {
      model: opts.conceptEditModel,
      input: {
        prompt: buildEditPrompt(promptOpts),
        image_url: opts.referenceImageUrl,
        num_images: 1,
      },
    };
  }

  return {
    model: opts.textToImageModel,
    input: {
      prompt: buildRenderPrompt({ ...promptOpts, afterDescription: opts.afterDescription, styleRecommendation: opts.styleRecommendation }),
      num_images: 1,
      image_size: { width: opts.imageSize, height: opts.imageSize },
    },
  };
}
