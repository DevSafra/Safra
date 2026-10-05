import { describe, expect, it } from 'vitest';

import { allowedAmenityCodes, parseSearch } from './search-query';

/*
  The amenity allow-list the results page AND its two routes share (audit 2026-10-04).

  The routes used to keep only amenities with a non-zero catalogue count, which covers room-level
  links only; a pool declared on the building was dropped from every scroll batch and from the map.
*/
describe('allowedAmenityCodes', () => {
  it('allows an amenity the catalogue counts zero properties for', () => {
    const allowed = allowedAmenityCodes([
      { code: 'wifi', propertyCount: 12 },
      { code: 'pool', propertyCount: 0 },
    ] as { code: string; propertyCount: number }[]);

    expect(allowed.has('pool')).toBe(true);
    expect(allowed.has('wifi')).toBe(true);
  });

  /* The opposite control: a code the catalogue does not list is still refused. */
  it('allows nothing the catalogue does not list', () => {
    expect(allowedAmenityCodes([{ code: 'wifi' }]).has('helipad')).toBe(false);
  });
});

/*
  «Near a landmark» and «near a type of place» are ONE criterion (audit 2026-10-04). The API takes
  one or the other; a URL carrying both showed the type as chosen while the search ignored it.
*/
describe('the near criterion', () => {
  it('reads a URL carrying both as the landmark alone, so no ignored choice is shown', () => {
    const parsed = parseSearch(
      { citySlug: 'damascus', nearLandmark: 'umayyad-mosque', nearKind: 'airport' },
      new Set(),
    );

    expect(parsed.nearLandmark).toBe('umayyad-mosque');
    expect(parsed.nearKind).toBeUndefined();
  });

  /* The opposite control: a type of place on its own is kept. */
  it('keeps a type of place chosen without a landmark', () => {
    const parsed = parseSearch({ citySlug: 'damascus', nearKind: 'airport' }, new Set());

    expect(parsed.nearKind).toBe('airport');
  });
});
