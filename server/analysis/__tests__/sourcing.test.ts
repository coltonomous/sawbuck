import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module before importing sourcing
vi.mock('../../db/index.js', () => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  const mockInnerJoin = vi.fn();
  const mockWhere = vi.fn();
  const mockThen = vi.fn();

  return {
    db: {
      select: mockSelect.mockReturnValue({
        from: mockFrom.mockReturnValue({
          innerJoin: mockInnerJoin.mockReturnValue({
            where: mockWhere.mockReturnValue({
              then: mockThen,
            }),
          }),
          where: mockWhere.mockReturnValue({
            then: mockThen,
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    },
  };
});

// Mock schema
vi.mock('../../db/schema.js', () => ({
  materials: { refinishingPlanId: 'refinishing_plan_id' },
  refinishingPlans: { id: 'id', listingId: 'listing_id' },
}));

// Mock dependencies
vi.mock('../refinishing.js', () => ({
  parsePlanSteps: vi.fn().mockReturnValue([]),
}));

vi.mock('../../lib/search-urls.js', () => ({
  generateAllSearchUrls: vi.fn().mockReturnValue({ amazon: '', homeDepot: '', lowes: '' }),
}));

vi.mock('../../lib/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getMaterialsForListing } from '../sourcing.js';
import { db } from '../../db/index.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getMaterialsForListing', () => {
  it('returns materials joined through plans for a listing', async () => {
    const mockMaterials = [
      { id: 1, refinishingPlanId: 10, productName: 'Sandpaper 220' },
      { id: 2, refinishingPlanId: 10, productName: 'Wood Stain' },
    ];

    // The function uses: db.select({m: materials}).from(materials).innerJoin(...).where(...).then(rows => rows.map(r => r.m))
    const mockThen = vi.fn().mockImplementation((mapper) => {
      return Promise.resolve(mapper(mockMaterials.map(m => ({ m }))));
    });

    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: mockThen,
          }),
        }),
      }),
    });

    const result = await getMaterialsForListing(5);

    expect(result).toEqual(mockMaterials);
    expect(db.select).toHaveBeenCalled();
  });
});
