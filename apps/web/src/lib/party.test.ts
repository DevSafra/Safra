import { describe, expect, it } from 'vitest';

import { partyFromQuery } from './party';

/**
 * The party a checkout submits (audit 2026-10-06).
 *
 * REGRESSION: the checkout read `Number(?adults=)` and nothing else, so a typed or tampered link put
 * `0`, `-3`, NaN or `40` into the summary and into a booking request the API then refused, after
 * the guest had filled in the whole form.
 */
describe('partyFromQuery', () => {
  const only = (adults: string | undefined) =>
    partyFromQuery({ adults, children: undefined, infants: undefined }).adults;

  it('keeps a sensible party as written', () => {
    expect(partyFromQuery({ adults: '3', children: '1', infants: '1' })).toStrictEqual({
      adults: 3,
      children: 1,
      infants: 1,
    });
  });

  it.each([
    ['absent', undefined, 2],
    ['empty', '', 2],
    ['zero', '0', 1],
    ['negative', '-3', 1],
    ['not a number', 'abc', 2],
    ['fractional', '2.7', 2],
    ['above the contract ceiling', '40', 30],
    ['infinite', 'Infinity', 2],
  ])('holds %s adults to a whole number from one to thirty', (_label, raw, expected) => {
    expect(only(raw)).toBe(expected);
  });

  it('bounds children and infants to the contract and never below zero', () => {
    expect(partyFromQuery({ adults: '2', children: '-1', infants: '99' })).toStrictEqual({
      adults: 2,
      children: 0,
      infants: 10,
    });
  });
});
