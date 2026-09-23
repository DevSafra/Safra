import { describe, expect, it } from 'vitest';

import { publicCoordinate } from './public-location.js';

/**
 * These cover the NARROWING. The rounding itself is a generated column now, and
 * `catalog.integration.test.ts` holds it to account against a real database — a unit test
 * here could only re-implement the rounding and then agree with itself.
 */
describe('publicCoordinate', () => {
  it('passes a formatted numeric through unchanged', () => {
    expect(publicCoordinate('33.515')).toBe('33.515');
    /* Trailing zeros are significant: numeric(6,3) emits them and they state the precision. */
    expect(publicCoordinate('33.500')).toBe('33.500');
    expect(publicCoordinate('-0.001')).toBe('-0.001');
  });

  it('answers null for a row that has no coordinate', () => {
    expect(publicCoordinate(null)).toBeNull();
    expect(publicCoordinate(undefined)).toBeNull();
  });

  /*
    The Gulf of Guinea regression, kept pointed at this layer too.

    A blank string must never become a coordinate. It cannot arrive from the generated
    column any more — `nullif(latitude, '')` makes it null before it gets here — but this
    function is the last narrowing before a number reaches a map, and a future caller
    handing it a raw text column must not land a listing at 0,0.
  */
  it('refuses a blank string rather than reading it as zero', () => {
    expect(publicCoordinate('')).toBeNull();
    expect(publicCoordinate('   ')).toBeNull();
  });

  it('refuses anything that is not a number or a string', () => {
    expect(publicCoordinate({})).toBeNull();
    expect(publicCoordinate([33.5])).toBeNull();
    expect(publicCoordinate(true)).toBeNull();
    expect(publicCoordinate(Number.NaN)).toBeNull();
  });
});
