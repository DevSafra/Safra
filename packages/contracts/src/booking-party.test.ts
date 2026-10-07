import { describe, expect, it } from 'vitest';

import { bookingCreateSchema } from './booking.js';

/**
 * The party on a booking is validated by the CONTRACT, whatever the checkout sends (audit
 * 2026-10-06). The page now clamps `?adults=` too, but a tampered request skips the page, so this
 * is the boundary that has to hold: a whole number of adults from one to thirty, never coerced.
 */
describe('bookingCreateSchema: the party', () => {
  const base = {
    unitId: '7d1f2c4e-1b2a-4c3d-9e8f-0a1b2c3d4e5f',
    checkIn: '2031-03-10',
    checkOut: '2031-03-12',
    guest: {
      fullName: 'Rania Haddad',
      email: 'rania@safra.test',
      phone: '+963933123456',
    },
    idempotencyKey: 'party-test-0001-abcdef',
  };

  it('accepts a whole party inside the ceilings', () => {
    expect(
      bookingCreateSchema.safeParse({ ...base, adults: 2, children: 1 }).success,
    ).toBe(true);
  });

  it.each([
    ['zero', 0],
    ['negative', -2],
    ['above thirty', 31],
    ['fractional', 2.5],
    ['a numeric string', '3'],
    ['not a number', Number.NaN],
    ['missing', undefined],
  ])('refuses %s adults', (_label, adults) => {
    expect(bookingCreateSchema.safeParse({ ...base, adults }).success).toBe(false);
  });

  it.each([-1, 21, 1.5])('refuses %s children', (children) => {
    expect(bookingCreateSchema.safeParse({ ...base, adults: 2, children }).success).toBe(
      false,
    );
  });
});
