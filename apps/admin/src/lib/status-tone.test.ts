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
    ['partnerApplicationStatus', t.enums.partnerApplicationStatus],
    ['disputeStatus', t.enums.disputeStatus],
    ['payoutStatus', t.enums.payoutStatus],
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

  /**
   * And ACROSS vocabularies, where two different statuses share a word but not a colour.
   *
   * The check above is per vocabulary, deliberately — «معتمد» is a fine label for both an approved
   * partner and an approved document, because no screen shows both. But that reasoning holds only
   * while the two words carry the SAME colour. When they do not, one word appears in two colours,
   * which is precisely the rendering fault the per-vocabulary check exists to prevent, one screen
   * further out.
   *
   * ## Why this is here rather than only in the browser sweep
   *
   * `navigation.spec.ts` catches it — it walks twenty sections comparing pill text to pill colour —
   * but only on a day when both screens happen to be SHOWING both statuses. «ملغاة» was
   * `paymentStatus.waived` (stone) and `giftCardStatus.cancelled` (red) for three weeks and the
   * sweep was green throughout, because الدفع had no waived row in it. It went red on 2026-08-27
   * when one appeared, and a third status was about to join them.
   *
   * A word-and-tone comparison over the catalogues needs no data at all and no browser, so it
   * fails the moment somebody WRITES the collision rather than the day one is finally displayed.
   *
   * The same VALUE in two vocabularies is exempt: `expired` is «منتهية» on بطاقات الهدايا and
   * «منتهٍ» on الإعلانات, and where the word does match it is one status, one colour, by
   * construction.
   */
  it('never gives one word two colours across vocabularies', () => {
    const VOCABULARIES: readonly (readonly [string, Record<string, string>])[] = [
      ['bookingStatus', t.bookingStatus],
      ['paymentStatus', t.enums.paymentStatus],
      ['propertyStatus', t.enums.propertyStatus],
      ['verification', t.enums.verification],
      ['partnerApplicationStatus', t.enums.partnerApplicationStatus],
      ['disputeStatus', t.enums.disputeStatus],
      ['payoutStatus', t.enums.payoutStatus],
      ['giftCardStatus', t.enums.giftCardStatus],
      ['couponStatus', t.enums.couponStatus],
      ['couponPartnerStatus', t.enums.couponPartnerStatus],
      ['adStatus', t.enums.adStatus],
      ['adInvoiceStatus', t.enums.adInvoiceStatus],
      ['userStatus', t.enums.userStatus],
      ['notificationStatus', t.enums.notificationStatus],
    ];

    /** word → the (status, tone) pairs that render it. */
    const byWord = new Map<string, Map<string, string>>();

    for (const [name, map] of VOCABULARIES) {
      for (const [status, word] of Object.entries(map)) {
        const tone = statusTone(status);
        const pairs = byWord.get(word) ?? new Map<string, string>();

        /* Keyed by STATUS, so the same value in two vocabularies collapses to one entry. */
        pairs.set(status, `${tone} (${name}.${status})`);
        byWord.set(word, pairs);
      }
    }

    const clashes = [...byWord.entries()]
      .filter(
        ([, pairs]) => new Set([...pairs.values()].map((v) => v.split(' ')[0])).size > 1,
      )
      .map(
        ([word, pairs]) => `«${word}» renders as ${[...pairs.values()].join(' and ')}`,
      );

    expect(clashes).toStrictEqual([]);
  });
});
