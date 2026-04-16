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
 * Build the fal.ai request (model + input) for a concept render using
 * the image-editing model. A reference image is required.
 */
export function buildConceptRenderRequest(opts: {
  concept: { finishType: string; label: string; summary: string };
  furnitureType: string;
  referenceImageUrl: string;
  conceptEditModel: string;
}): { model: string; input: Record<string, unknown> } {
  return {
    model: opts.conceptEditModel,
    input: {
      prompt: buildEditPrompt({
        furnitureType: opts.furnitureType,
        finishType: opts.concept.finishType,
        label: opts.concept.label,
        summary: opts.concept.summary,
      }),
      image_url: opts.referenceImageUrl,
      num_images: 1,
    },
  };
}
