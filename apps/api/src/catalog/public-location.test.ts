import { describe, expect, it } from 'vitest';

import { PUBLIC_COORDINATE_DECIMALS } from '@safra/contracts';

import { fuzzCoordinate } from './public-location.js';

/**
 * What a listing's public coordinates are allowed to be.
 *
 * This is the arithmetic behind a promise the product makes in words — «الموقع الدقيق
 * يظهر بعد تأكيد الحجز» — and it is the ONLY thing protecting the exact location, because
 * it protects it by never sending it. Every assertion here was watched to fail.
 */
describe('fuzzCoordinate', () => {
  it('rounds to about 100 m, discarding the metres that would find a door', () => {
    expect(fuzzCoordinate('33.5138192')).toBe('33.514');
    expect(fuzzCoordinate('36.2765401')).toBe('36.277');
  });

  it('keeps three decimals even when they are zeros, so the precision is not readable from the string', () => {
    /*
      `33.5` and `33.500` are the same number and a DIFFERENT disclosure: a bare `33.5`
      tells a reader the value was never more precise, and `toFixed` is what stops the
      payload leaking how much was thrown away.
    */
    expect(fuzzCoordinate('33.5')).toBe('33.500');
    expect(fuzzCoordinate(33)).toBe('33.000');
  });

  it('rounds to the precision the contract states, not a local copy of it', () => {
    expect(PUBLIC_COORDINATE_DECIMALS).toBe(3);
    expect(fuzzCoordinate('1.23456789')?.split('.')[1]).toHaveLength(
      PUBLIC_COORDINATE_DECIMALS,
    );
  });

  it('answers null for anything that is not a coordinate, rather than inventing one', () => {
    for (const value of [
      null,
      undefined,
      'somewhere',
      {},
      [],
      true,
      Number.NaN,
      Infinity,
    ]) {
      expect(fuzzCoordinate(value)).toBeNull();
    }
  });

  it('answers null for a BLANK string rather than the Gulf of Guinea', () => {
    /*
      `Number('')` is 0, so a blank column used to round to "0.000" — a real pair of
      coordinates, 600 km off the coast of Ghana. Two numbers nobody rendered hid it;
      a map drawn on them would not have.
    */
    for (const value of ['', '   ', '\n']) {
      expect(fuzzCoordinate(value)).toBeNull();
    }
  });
});
