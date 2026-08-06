import { describe, expect, it } from 'vitest';

import { statusTone } from './status-tone';
import { t } from './strings';

/**
 * The console's import point for the shared status colours.
 *
 * The map itself and the rule that no two statuses on one screen share a colour are tested where
 * they live, in `packages/ui/src/status.test.ts` — a per-vocabulary check the console cannot see.
 * What is worth asserting HERE is the re-export: `@/lib/status-tone` is what fourteen console
 * files import, and a barrel that stopped forwarding would be a silent grey console rather than
 * a build error, because `faint` is a valid Tone.
 */
describe('the console reads the shared status colours', () => {
  it('forwards to the real map rather than falling back', () => {
    expect(statusTone('confirmed')).toBe('ok');
    expect(statusTone('pending_confirmation')).toBe('pend');
    expect(statusTone('cancelled')).toBe('bad');
  });

  /**
   * The two collisions Bashar reported in the console's own tables. They are asserted again here,
   * against the console's import, because these are the screens they were reported on.
   */
  it('tells apart the statuses that share a console table', () => {
    expect(statusTone('confirmed')).not.toBe(statusTone('completed'));
    expect(statusTone('approved')).not.toBe(statusTone('published'));
    expect(statusTone('cancelled')).not.toBe(statusTone('disputed'));
  });

  it('gives an unknown status no signal at all', () => {
    expect(statusTone('some_future_status')).toBe('faint');
  });
});

/**
 * The other half of "every card its own colour": no two statuses on one screen may share a WORD.
 *
 * `pending` and `processing` both read «قيد المعالجة» until 2026-08-06. While every status in a
 * category shared one colour that was merely vague; once each has its own, one word in two colours
 * reads as a rendering fault. So the labels have to be as distinct as the colours, and the check
 * belongs beside the colour check rather than in somebody's head.
 *
 * Compared per VOCABULARY, not globally: «معتمد» is a fine label for both an approved partner and
 * an approved document, because no screen shows both.
 */
describe('no two statuses on one screen share a word', () => {
  it.each([
    ['bookingStatus', t.bookingStatus],
    ['paymentStatus', t.enums.paymentStatus],
    ['propertyStatus', t.enums.propertyStatus],
    ['verification', t.enums.verification],
    ['disputeStatus', t.enums.disputeStatus],
  ])('%s', (_name, map) => {
    const byLabel = new Map<string, string[]>();

    for (const [status, labelText] of Object.entries(map)) {
      byLabel.set(labelText, [...(byLabel.get(labelText) ?? []), status]);
    }

    const clashes = [...byLabel.entries()]
      .filter(([, statuses]) => statuses.length > 1)
      .map(([labelText, statuses]) => `«${labelText}»: ${statuses.join(', ')}`);

    expect(clashes).toStrictEqual([]);
  });
});
