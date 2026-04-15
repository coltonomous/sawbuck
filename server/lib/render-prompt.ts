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
