/**
 * Tests for project ingestion into the RAG knowledge base.
 *
 * Tests the flipToChunk transformation logic and getProjectMaterials
 * without needing the embedding model or vector store.
 */

import { describe, it, expect } from 'vitest';
import { flipToChunk, type CompletedFlip } from './projects.js';

const baseFlip: CompletedFlip = {
  projectId: 1,
  projectName: 'Test Dresser',
  purchasePrice: 80,
  totalMaterialCost: 95,
  hoursInvested: 12,
  soldPrice: 340,
  profit: 165,
  roiPercentage: 134,
  purchaseDate: new Date('2025-01-01'),
  soldDate: new Date('2025-01-22'),
  furnitureType: 'dresser',
  furnitureStyle: 'mid-century modern',
  woodSpecies: 'walnut',
  conditionScore: 5,
  conditionNotes: 'scratched top, missing drawer pulls',
  askingPrice: 100,
};

describe('flipToChunk', () => {
  it('builds a chunk with all fields populated', () => {
    const chunk = flipToChunk(baseFlip, ['Citristrip Gel', 'Minwax Dark Walnut']);

    expect(chunk.type).toBe('project');
    expect(chunk.source).toBe('project:1');
    expect(chunk.title).toContain('mid-century modern');
    expect(chunk.title).toContain('walnut');
    expect(chunk.title).toContain('dresser');
    expect(chunk.title).toContain('flip');
  });

  it('includes financial data in content', () => {
    const chunk = flipToChunk(baseFlip, []);

    expect(chunk.content).toContain('Purchase price: $80');
    expect(chunk.content).toContain('Material cost: $95');
    expect(chunk.content).toContain('Hours invested: 12');
    expect(chunk.content).toContain('Sold for: $340');
    expect(chunk.content).toContain('Profit: $165');
    expect(chunk.content).toContain('ROI: 134%');
  });

  it('calculates days to flip from dates', () => {
    const chunk = flipToChunk(baseFlip, []);
    expect(chunk.content).toContain('Days to flip: 21');
  });

  it('includes materials used when provided', () => {
    const chunk = flipToChunk(baseFlip, ['Citristrip Gel', 'Minwax Dark Walnut']);
    expect(chunk.content).toContain('Materials used: Citristrip Gel, Minwax Dark Walnut');
  });

  it('stores structured metadata for retrieval formatting', () => {
    const chunk = flipToChunk(baseFlip, []);
    const meta = chunk.metadata;

    expect(meta.projectId).toBe(1);
    expect(meta.furnitureType).toBe('dresser');
    expect(meta.purchasePrice).toBe(80);
    expect(meta.soldPrice).toBe(340);
    expect(meta.roiPercentage).toBe(134);
    expect(meta.daysToFlip).toBe(21);
  });

  it('handles missing optional fields gracefully', () => {
    const minimalFlip: CompletedFlip = {
      projectId: 2,
      projectName: 'Mystery Piece',
      purchasePrice: 50,
      totalMaterialCost: null,
      hoursInvested: null,
      soldPrice: 100,
      profit: 50,
      roiPercentage: 100,
      purchaseDate: null,
      soldDate: null,
      furnitureType: null,
      furnitureStyle: null,
      woodSpecies: null,
      conditionScore: null,
      conditionNotes: null,
      askingPrice: null,
    };

    const chunk = flipToChunk(minimalFlip, []);
    expect(chunk.title).toBe('furniture flip');
    expect(chunk.content).toContain('Completed flip: furniture');
    expect(chunk.content).toContain('Purchase price: $50');
    expect(chunk.content).toContain('Sold for: $100');
    // Should NOT contain fields that are null
    expect(chunk.content).not.toContain('Style:');
    expect(chunk.content).not.toContain('Wood:');
    expect(chunk.content).not.toContain('Days to flip:');
  });

  it('handles zero profit correctly', () => {
    const breakEven: CompletedFlip = {
      ...baseFlip,
      profit: 0,
      roiPercentage: 0,
    };

    const chunk = flipToChunk(breakEven, []);
    expect(chunk.content).toContain('Profit: $0');
    expect(chunk.content).toContain('ROI: 0%');
  });

  it('handles negative profit (loss)', () => {
    const loss: CompletedFlip = {
      ...baseFlip,
      soldPrice: 50,
      profit: -145,
      roiPercentage: -60,
    };

    const chunk = flipToChunk(loss, []);
    expect(chunk.content).toContain('Profit: $-145');
    expect(chunk.content).toContain('ROI: -60%');
  });
});
