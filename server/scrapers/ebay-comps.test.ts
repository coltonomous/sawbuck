import { describe, it, expect } from 'vitest';
import { buildQueryVariants } from './ebay-comps.js';
import type { CompSearchParams } from './ebay-comps.js';

describe('buildQueryVariants', () => {
  it('returns style + type as first variant when both available', () => {
    const params: CompSearchParams = {
      furnitureType: 'dresser',
      furnitureStyle: 'mid-century modern',
      woodSpecies: 'walnut',
      title: 'Beautiful MCM Walnut Dresser',
    };
    const variants = buildQueryVariants(params);
    expect(variants[0]).toBe('mid-century modern dresser');
  });

  it('includes wood + type variant', () => {
    const params: CompSearchParams = {
      furnitureType: 'dresser',
      furnitureStyle: 'mid-century modern',
      woodSpecies: 'walnut',
      title: 'Beautiful MCM Walnut Dresser',
    };
    const variants = buildQueryVariants(params);
    expect(variants).toContain('walnut dresser');
  });

  it('includes plain type variant', () => {
    const params: CompSearchParams = {
      furnitureType: 'dresser',
      furnitureStyle: null,
      woodSpecies: null,
      title: null,
    };
    const variants = buildQueryVariants(params);
    expect(variants).toContain('dresser');
  });

  it('uses first 4 title words as last resort', () => {
    const params: CompSearchParams = {
      furnitureType: null,
      furnitureStyle: null,
      woodSpecies: null,
      title: 'Beautiful MCM Walnut Dresser Extra Words',
    };
    const variants = buildQueryVariants(params);
    expect(variants).toContain('Beautiful MCM Walnut Dresser');
  });

  it('returns empty array when nothing provided', () => {
    const params: CompSearchParams = {
      furnitureType: null,
      furnitureStyle: null,
      woodSpecies: null,
      title: null,
    };
    expect(buildQueryVariants(params)).toEqual([]);
  });

  it('does not duplicate title keywords if they match another variant', () => {
    const params: CompSearchParams = {
      furnitureType: 'dresser',
      furnitureStyle: null,
      woodSpecies: null,
      title: 'dresser',
    };
    const variants = buildQueryVariants(params);
    // Should not have 'dresser' twice
    expect(variants.filter(v => v === 'dresser').length).toBe(1);
  });
});
