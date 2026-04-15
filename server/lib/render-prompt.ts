/**
 * Shared concept render prompt + strength logic.
 * Used by both the agent pipeline (plan-options.ts) and the
 * on-demand render route (listings.ts) so they stay in sync.
 */

const PAINT_RE = /paint|chalk|milk|lacquer|enamel/i;

function isPaintFinish(finishType: string, summary: string): boolean {
  return PAINT_RE.test(finishType) || PAINT_RE.test(summary);
}

/**
 * Pick img2img strength based on finish type.
 * Paint/opaque finishes need higher strength since the surface color changes completely.
 * Stain/oil finishes use moderate strength to preserve wood grain while changing the tone.
 */
export function renderStrength(finishType: string, summary: string): number {
  return isPaintFinish(finishType, summary) ? 0.80 : 0.65;
}

/**
 * Build a render prompt that is visually aggressive enough that
 * Flux img2img produces a clearly different surface from the source.
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
    return `A ${furnitureType} with a ${label} finish. ${summary}. The entire surface is covered in ${label} — no bare wood visible. The paint color, sheen, and texture must dominate the image. Style: ${style}. Same piece shape and proportions as the reference photo. Photorealistic product photography, studio lighting with specular highlights to show the paint finish.`;
  }

  return `The same ${furnitureType} from the reference photo with a completely different surface finish: ${label}. ${summary}. After: ${afterDesc}. The surface color, sheen, and texture must be clearly different from the original — show the ${finishType} finish in sharp detail (grain, tone, reflectivity). Style: ${style}. Same piece shape and proportions. Photorealistic product photography, studio lighting angled to highlight the surface texture and finish quality.`;
}
