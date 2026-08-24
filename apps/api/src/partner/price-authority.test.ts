import { describe, expect, it } from 'vitest';

import { PERMISSIONS as P } from '@safra/contracts';

import { assertMayPrice } from './price-authority.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * `price.update` was grantable and guarded nothing.
 *
 * A partner could tick "change prices" on an employee's role and it meant nothing in either
 * direction: the employee could change prices without it, because `property.manage_own` covered the
 * whole `PATCH`, and ticking it granted no power they did not already have. A capability that is
 * offered and does not bind is worse than a missing one — somebody believes a boundary is in place.
 *
 * These pin the two halves that make it bind: a price change is refused without it, and everything
 * that is NOT a price change is untouched by it.
 */
const claims = (permissions: string[]): AccessTokenClaims =>
  ({
    sub: '00000000-0000-0000-0000-000000000001',
    role: 'partner_employee',
    permissions,
    locale: 'ar',
    partnerId: '00000000-0000-0000-0000-0000000000b1',
  }) as AccessTokenClaims;

describe('who may set a price', () => {
  it('allows a price change from a holder of price.update', () => {
    expect(() => assertMayPrice(claims([P.PRICE_UPDATE]), true)).not.toThrow();
  });

  it('refuses a price change from somebody without it', () => {
    expect(() => assertMayPrice(claims([P.PROPERTY_MANAGE_OWN]), true)).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });

  /**
   * The half that keeps the check from becoming a route guard by accident.
   *
   * Renaming a room, changing a bed count, closing a date — none of them is a price, and an
   * employee holding `property.manage_own` alone must still be able to do their job. A check that
   * refused these would be `@RequirePermissions(P.PRICE_UPDATE)` on the route, which is the thing
   * this exists instead of.
   */
  it('does not stand in the way of a change that is not a price', () => {
    expect(() => assertMayPrice(claims([P.PROPERTY_MANAGE_OWN]), false)).not.toThrow();
    expect(() => assertMayPrice(claims([]), false)).not.toThrow();
  });

  /** No claims at all is refused, not waved through — the token is where authority comes from. */
  it('refuses a price change with no claims', () => {
    expect(() => assertMayPrice(undefined, true)).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });
});
