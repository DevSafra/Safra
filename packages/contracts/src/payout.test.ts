import { describe, expect, it } from 'vitest';

import { PAYOUT_STATUSES, SETTLED_PAYOUT_STATUSES, payoutIsSettled } from './payout.js';

/**
 * The settled/open split مستحقاتي groups on.
 *
 * A payout screen that files a state into the wrong half either shows a partner money that has
 * already arrived as still coming, or — much worse — hides one they are still owed in a list of
 * history. Both are silent: nothing throws, and the page renders.
 *
 * The portal shipped with a hand-written set of five status strings, none of which matched the
 * enum: `pending`, `released` and `processing` do not exist, and the real `accruing`,
 * `pending_release` and `scheduled` were absent. Every open payout was therefore filed under
 * «مكتملة» and the summary read «لا مستحقات قيد التحويل» above $3,264.30 that was owed. Found by
 * looking at the rendered page (2026-09-04); this is what stops it recurring.
 */
describe('payoutIsSettled', () => {
  it('names only states that have reached an end', () => {
    expect(SETTLED_PAYOUT_STATUSES.every((one) => PAYOUT_STATUSES.includes(one))).toBe(
      true,
    );
    expect([...SETTLED_PAYOUT_STATUSES].sort()).toStrictEqual(['cancelled', 'paid']);
  });

  /*
    The whole enum is classified with nothing left over, and the list is written out rather than
    derived — this assertion exists to FAIL when a status is added, so a count or a filter over the
    same constant would agree with any change made to it.
  */
  it('treats every other state as still owed', () => {
    const open = PAYOUT_STATUSES.filter((one) => !payoutIsSettled(one));

    expect(open).toStrictEqual(['accruing', 'pending_release', 'on_hold', 'scheduled']);
  });

  /**
   * A state nobody declared is OPEN, not settled.
   *
   * The safe direction: an unknown status appears in front of the partner where they can ask about
   * it, rather than being filed into history where it disappears. Classifying by listing the
   * settled ones is what makes that the default.
   */
  it('does not classify a status nobody declared as settled', () => {
    expect(payoutIsSettled('something_new')).toBe(false);
  });
});
