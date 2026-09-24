import { describe, expect, it } from 'vitest';

import {
  LISTING_READINESS_CHECKS,
  LISTING_READINESS_COST,
  listingGaps,
  worstCost,
  type ListingReadinessCheck,
} from './readiness.js';

/**
 * The shared definition of «operationally incomplete», held to what its readers assume.
 *
 * Three apps read this list and one of the assumptions is invisible in every type: that the checks
 * are ordered WORST FIRST. The partner's dashboard renders them in array order, so a scrambled
 * list puts «not on the map» above «does not appear in search at all» — an understatement of
 * exactly the kind the breakdown exists to remove. A mutation that swapped the first two passed
 * every integration test, which is why this file exists.
 */
describe('listing readiness', () => {
  const SEVERITY: Record<'invisible' | 'reach' | 'quality', number> = {
    invisible: 3,
    reach: 2,
    quality: 1,
  };

  /** Nothing missing — the starting point every case below breaks one thing from. */
  const complete = {
    unitCount: 2,
    hasLocation: true,
    hasPhotograph: true,
    hasDescription: true,
  };

  it('orders the checks worst first, because the dashboard reads them in order', () => {
    const costs = LISTING_READINESS_CHECKS.map(
      (check) => SEVERITY[LISTING_READINESS_COST[check]],
    );

    for (let i = 1; i < costs.length; i += 1) {
      expect(
        costs[i - 1],
        `${LISTING_READINESS_CHECKS[i - 1]} must not be listed above the more serious ${LISTING_READINESS_CHECKS[i]}`,
      ).toBeGreaterThanOrEqual(costs[i]!);
    }
  });

  it('gives every check a cost, so none can be added without deciding what it means', () => {
    for (const check of LISTING_READINESS_CHECKS) {
      expect(LISTING_READINESS_COST[check], `${check} has no cost`).toBeDefined();
    }
    expect(Object.keys(LISTING_READINESS_COST).sort()).toEqual(
      [...LISTING_READINESS_CHECKS].sort(),
    );
  });

  it('has exactly one check that makes a listing unreachable', () => {
    /*
      `unit` is the only gap that removes a listing from search entirely — verified against the
      running system, not assumed. If a second ever earns that label the dashboard's «what to do
      first» stops being a single answer, and this failing is the prompt to think about it.
    */
    const invisible = LISTING_READINESS_CHECKS.filter(
      (check) => LISTING_READINESS_COST[check] === 'invisible',
    );

    expect(invisible).toEqual(['unit']);
  });

  describe('listingGaps', () => {
    it('reports nothing for a complete listing', () => {
      expect(listingGaps(complete)).toEqual([]);
    });

    it.each([
      ['unit', { ...complete, unitCount: 0 }],
      ['location', { ...complete, hasLocation: false }],
      ['photograph', { ...complete, hasPhotograph: false }],
      ['description', { ...complete, hasDescription: false }],
    ])('reports %s and nothing else when only that is missing', (check, facts) => {
      expect(listingGaps(facts)).toEqual([check]);
    });

    it('reports every gap, in check order', () => {
      const gaps = listingGaps({
        unitCount: 0,
        hasLocation: false,
        hasPhotograph: false,
        hasDescription: false,
      });

      expect(gaps).toEqual([...LISTING_READINESS_CHECKS]);
    });

    /*
      A listing cannot have fewer than zero units, but a count arriving as -1 from a bad cast must
      not read as «has units». The comparison is `<= 0` for that reason and this pins it.
    */
    it('treats a negative unit count as no units', () => {
      expect(listingGaps({ ...complete, unitCount: -1 })).toContain('unit');
    });
  });

  describe('worstCost', () => {
    it('is null when nothing is missing', () => {
      expect(worstCost([])).toBeNull();
    });

    it('names the most serious gap, not the first one passed', () => {
      /* Deliberately in the wrong order: the answer is about severity, not position. */
      expect(worstCost(['description', 'unit'])).toBe('invisible');
      expect(worstCost(['photograph', 'location'])).toBe('reach');
      expect(worstCost(['photograph', 'description'])).toBe('quality');
    });

    it('answers for every single check on its own', () => {
      for (const check of LISTING_READINESS_CHECKS) {
        expect(worstCost([check]), check).toBe(LISTING_READINESS_COST[check]);
      }
    });

    it('ignores a check it does not know, rather than throwing', () => {
      /*
        The API may be ahead of a client. An unknown code must degrade to «something is wrong»
        rather than take down a dashboard — the same reasoning the card follows when it prints a
        key it has no sentence for.
      */
      expect(worstCost(['nonsense' as ListingReadinessCheck])).toBe('quality');
    });
  });
});
