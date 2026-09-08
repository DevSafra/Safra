import { describe, expect, it } from 'vitest';

import { PARTNER_EMPLOYEE_PERMISSIONS } from '@safra/contracts';

import { partnerMessages } from './partner.js';

/**
 * Every capability a partner can grant has a word.
 *
 * ## The defect this closes
 *
 * `dispute.respond_own` joined `PARTNER_EMPLOYEE_PERMISSIONS` with finding 223 and nobody added it
 * to the partner catalogue, so لوحة الشريك offered a checkbox labelled «dispute.respond_own» beside
 * eleven Arabic phrases — an owner deciding what a receptionist may do, reading a permission string.
 * Found by sweeping the rendered screens for identifier-shaped text on 2026-09-08, not by any test.
 *
 * The renderer's fallback is right — an unlabelled capability announces itself rather than
 * appearing as a blank checkbox somebody ticks without knowing what they granted — and a fallback
 * is not a substitute for the word. This is the check that the fallback should never be reached.
 *
 * ## Read from the CONTRACT, not from a list here
 *
 * `PARTNER_EMPLOYEE_PERMISSIONS` is what the API validates against and what the screen renders, so
 * a capability added there is covered by this the same day. A hand-written list would go stale in
 * exactly the way the catalogue did.
 */
describe('the capabilities a partner can grant', () => {
  const capabilities = partnerMessages('ar').employeeRoles.capability;

  it('finds the contract it is checking', () => {
    /* A renamed or emptied export would make the assertion below pass over nothing. */
    expect(PARTNER_EMPLOYEE_PERMISSIONS.length).toBeGreaterThan(5);
  });

  it('all have a word in the partner catalogue', () => {
    const unnamed = PARTNER_EMPLOYEE_PERMISSIONS.filter(
      (permission) => typeof capabilities[permission] !== 'string',
    );

    expect(
      unnamed,
      'These are grantable from لوحة الشريك and have no Arabic name, so the checkbox reads as a ' +
        'permission string. Add them to `employeeRoles.capability` in messages/partner/ar.ts.',
    ).toStrictEqual([]);
  });

  /**
   * And no two capabilities share a word.
   *
   * Two identical labels in a checkbox list is worse than an identifier: a partner ticks one
   * believing it is the other, and what they granted is not what they read.
   */
  it('never gives two capabilities the same word', () => {
    const byWord = new Map<string, string[]>();

    for (const permission of PARTNER_EMPLOYEE_PERMISSIONS) {
      const word = capabilities[permission];

      if (word === undefined) continue;

      byWord.set(word, [...(byWord.get(word) ?? []), permission]);
    }

    expect(
      [...byWord.entries()]
        .filter(([, permissions]) => permissions.length > 1)
        .map(([word, permissions]) => `«${word}»: ${permissions.join(', ')}`),
    ).toStrictEqual([]);
  });
});
