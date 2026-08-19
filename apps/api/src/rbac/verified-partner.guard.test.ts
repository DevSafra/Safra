import type { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import type { Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { VerifiedPartnerGuard } from './verified-partner.guard.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Step 7 of «انضم كشريك»: prices, dates and images wait for verification (Bashar, 2026-08-19).
 *
 * The routes it guards are asserted in the partner integration suites; what is asserted HERE is
 * the decision itself, including the two ways a guard like this fails open — a missing partner id
 * and a missing row. Both are the shape of bug that no route test would catch, because both look
 * like "the request went through".
 */
function guardFor(
  verification: string | null,
  required: boolean,
): { guard: VerifiedPartnerGuard; queries: number } {
  const state = { queries: 0 };

  const db = {
    execute: () => {
      state.queries += 1;

      return Promise.resolve({ rows: verification === null ? [] : [{ verification }] });
    },
  } as unknown as Database;

  const reflector = {
    getAllAndOverride: () => required,
  } as unknown as Reflector;

  return {
    guard: new VerifiedPartnerGuard(reflector, db),
    get queries() {
      return state.queries;
    },
  };
}

function contextFor(claims: Partial<AccessTokenClaims> | undefined) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: claims }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as never;
}

const PARTNER_USER_ID = '00000000-0000-0000-0000-0000000000a1';

const partner: Partial<AccessTokenClaims> = {
  sub: PARTNER_USER_ID,
  role: 'partner',
  partnerId: '00000000-0000-0000-0000-0000000000b1',
};

describe('VerifiedPartnerGuard', () => {
  it('lets a verified partner through', async () => {
    const { guard } = guardFor('approved', true);

    await expect(guard.canActivate(contextFor(partner))).resolves.toBe(true);
  });

  /**
   * `in_review` is not "nearly verified".
   *
   * It means a human is looking at the documents right now, and a partner who could publish
   * prices during that window would make the review pointless.
   */
  it.each(['pending', 'in_review', 'rejected'])(
    'refuses a partner who is %s',
    async (state) => {
      const { guard } = guardFor(state, true);

      await expect(guard.canActivate(contextFor(partner))).rejects.toMatchObject({
        response: { code: ERROR.PARTNER_NOT_VERIFIED },
      });
    },
  );

  /** The first way a guard like this fails open: no partner id on the token at all. */
  it('refuses a caller with no partner id', async () => {
    const { guard } = guardFor('approved', true);

    await expect(
      guard.canActivate(contextFor({ sub: PARTNER_USER_ID, role: 'customer' })),
    ).rejects.toMatchObject({ response: { code: ERROR.PARTNER_NOT_VERIFIED } });
  });

  it('refuses a caller with no claims at all', async () => {
    const { guard } = guardFor('approved', true);

    await expect(guard.canActivate(contextFor(undefined))).rejects.toMatchObject({
      response: { code: ERROR.PARTNER_NOT_VERIFIED },
    });
  });

  /**
   * The second: a partner id pointing at a row that is gone.
   *
   * A soft-deleted partner keeps a valid token until it expires. Falling open on the empty result
   * would make every gated route reachable by exactly the accounts that should reach none of them.
   */
  it('refuses when the partner row has been deleted', async () => {
    const { guard } = guardFor(null, true);

    await expect(guard.canActivate(contextFor(partner))).rejects.toMatchObject({
      response: { code: ERROR.PARTNER_NOT_VERIFIED },
    });
  });

  /** An ungated route costs nothing — no round trip, no decision. */
  it('does not touch the database on a route that did not ask for it', async () => {
    const harness = guardFor('pending', false);

    await expect(harness.guard.canActivate(contextFor(partner))).resolves.toBe(true);
    expect(harness.queries).toBe(0);
  });
});
