import { describe, it, expect } from 'vitest';
import { buildEditPrompt, buildRenderPrompt, buildConceptRenderRequest } from '../render-prompt.js';

describe('buildEditPrompt', () => {
  it('generates paint-specific instruction for paint finishes', () => {
    const prompt = buildEditPrompt({
      furnitureType: 'dresser',
      finishType: 'chalk_paint',
      label: 'Chalk White Paint',
      summary: 'Matte white finish with light distressing',
    });

    expect(prompt).toContain('Refinish this dresser');
    expect(prompt).toContain('Chalk White Paint');
    expect(prompt).toContain('Paint the entire wood surface');
    expect(prompt).toContain('No bare wood visible');
  });

  it('generates stain/oil instruction for non-paint finishes', () => {
    const prompt = buildEditPrompt({
      furnitureType: 'bookcase',
      finishType: 'stain',
      label: 'Dark Walnut Stain',
      summary: 'Deep brown tone with visible grain',
    });

    expect(prompt).toContain('Refinish this bookcase');
    expect(prompt).toContain('Dark Walnut Stain');
    expect(prompt).toContain('wood grain');
    expect(prompt).not.toContain('No bare wood visible');
  });

  it('detects paint variants in summary even when finishType is generic', () => {
    const prompt = buildEditPrompt({
      furnitureType: 'table',
      finishType: 'custom',
      label: 'Navy Lacquer',
      summary: 'Deep navy lacquer with high gloss',
    });

    expect(prompt).toContain('Paint the entire wood surface');
  });
});

describe('buildRenderPrompt', () => {
  it('generates text-to-image prompt for paint finishes', () => {
    const prompt = buildRenderPrompt({
      furnitureType: 'nightstand',
      finishType: 'milk_paint',
      label: 'Sage Green Milk Paint',
      summary: 'Soft green with slight texture',
    });

    expect(prompt).toContain('nightstand');
    expect(prompt).toContain('Sage Green Milk Paint');
    expect(prompt).toContain('Photorealistic');
  });

  it('uses afterDescription and styleRecommendation when provided', () => {
    const prompt = buildRenderPrompt({
      furnitureType: 'desk',
      finishType: 'oil',
      label: 'Tung Oil Natural',
      summary: 'Natural warm tone',
      afterDescription: 'Warm golden hue with matte sheen',
      styleRecommendation: 'Danish modern',
    });

    expect(prompt).toContain('Warm golden hue');
    expect(prompt).toContain('Danish modern');
  });

  it('falls back to summary/label when optional fields are missing', () => {
    const prompt = buildRenderPrompt({
      furnitureType: 'chair',
      finishType: 'wax',
      label: 'Beeswax Finish',
      summary: 'Soft sheen natural finish',
    });

    expect(prompt).toContain('Soft sheen natural finish');
    expect(prompt).toContain('Beeswax Finish');
  });
});

describe('buildConceptRenderRequest', () => {
  const baseConcept = { finishType: 'stain', label: 'Dark Walnut', summary: 'Deep brown tone' };

  it('uses Kontext model when reference image is available', () => {
    const { model, input } = buildConceptRenderRequest({
      concept: baseConcept,
      furnitureType: 'dresser',
      referenceImageUrl: 'https://fal.storage/uploaded.jpg',
      conceptEditModel: 'fal-ai/flux-kontext/dev',
      textToImageModel: 'fal-ai/flux/dev',
      imageSize: 768,
    });

    expect(model).toBe('fal-ai/flux-kontext/dev');
    expect(input.image_url).toBe('https://fal.storage/uploaded.jpg');
    expect(input.prompt).toContain('Refinish this dresser');
    expect(input.image_size).toBeUndefined();
  });

  it('uses text-to-image model when no reference image', () => {
    const { model, input } = buildConceptRenderRequest({
      concept: baseConcept,
      furnitureType: 'dresser',
      referenceImageUrl: null,
      conceptEditModel: 'fal-ai/flux-kontext/dev',
      textToImageModel: 'fal-ai/flux/dev',
      imageSize: 768,
    });

    expect(model).toBe('fal-ai/flux/dev');
    expect(input.image_url).toBeUndefined();
    expect(input.image_size).toEqual({ width: 768, height: 768 });
    expect(input.prompt).toContain('dresser');
  });

  it('passes afterDescription only to text-to-image path', () => {
    const withRef = buildConceptRenderRequest({
      concept: baseConcept,
      furnitureType: 'table',
      referenceImageUrl: 'https://example.com/img.jpg',
      conceptEditModel: 'fal-ai/flux-kontext/dev',
      textToImageModel: 'fal-ai/flux/dev',
      imageSize: 512,
      afterDescription: 'Golden honey finish',
    });

    const withoutRef = buildConceptRenderRequest({
      concept: baseConcept,
      furnitureType: 'table',
      referenceImageUrl: null,
      conceptEditModel: 'fal-ai/flux-kontext/dev',
      textToImageModel: 'fal-ai/flux/dev',
      imageSize: 512,
      afterDescription: 'Golden honey finish',
    });

    expect((withRef.input.prompt as string)).not.toContain('Golden honey');
    expect((withoutRef.input.prompt as string)).toContain('Golden honey');
  });

  it('always includes num_images: 1', () => {
    const withRef = buildConceptRenderRequest({
      concept: baseConcept,
      furnitureType: 'chair',
      referenceImageUrl: 'https://example.com/img.jpg',
      conceptEditModel: 'model-a',
      textToImageModel: 'model-b',
      imageSize: 768,
    });

    const withoutRef = buildConceptRenderRequest({
      concept: baseConcept,
      furnitureType: 'chair',
      referenceImageUrl: null,
      conceptEditModel: 'model-a',
      textToImageModel: 'model-b',
      imageSize: 768,
    });

    expect(withRef.input.num_images).toBe(1);
    expect(withoutRef.input.num_images).toBe(1);
  });
});
