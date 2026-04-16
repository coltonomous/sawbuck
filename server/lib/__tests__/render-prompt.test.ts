import { describe, it, expect } from 'vitest';
import { buildEditPrompt, buildConceptRenderRequest } from '../render-prompt.js';

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

describe('buildConceptRenderRequest', () => {
  const baseConcept = { finishType: 'stain', label: 'Dark Walnut', summary: 'Deep brown tone' };

  it('uses Kontext model and includes reference image', () => {
    const { model, input } = buildConceptRenderRequest({
      concept: baseConcept,
      furnitureType: 'dresser',
      referenceImageUrl: 'https://fal.storage/uploaded.jpg',
      conceptEditModel: 'fal-ai/flux-kontext/dev',
    });

    expect(model).toBe('fal-ai/flux-kontext/dev');
    expect(input.image_url).toBe('https://fal.storage/uploaded.jpg');
    expect(input.prompt).toContain('Refinish this dresser');
    expect(input.num_images).toBe(1);
  });
});
