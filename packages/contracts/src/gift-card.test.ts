import { describe, expect, it } from 'vitest';

import {
  GIFT_CARD_AMOUNTS,
  GIFT_CODE_ALPHABET,
  GIFT_CODE_ENTROPY_BITS,
  GIFT_CODE_LENGTH,
  giftCardPurchaseSchema,
  giftCardRedeemSchema,
  normaliseGiftCode,
} from './gift-card.js';

/**
 * The gift-card contract.
 *
 * `normaliseGiftCode` gets the most attention here, because it is the one function that MUST agree with
 * itself across two moments in time: a code is normalised before being hashed at creation, and again
 * before being hashed at redemption. A change that alters its output invalidates every card already
 * issued — and the symptom is "no card anybody bought works", with nothing pointing at the cause.
 */
describe('normaliseGiftCode', () => {
  const canonical = 'ABCDEFGHJKMNPQRSTVWX';

  it.each([
    ['already canonical', 'ABCDEFGHJKMNPQRSTVWX'],
    ['grouped', 'ABCDE-FGHJK-MNPQR-STVWX'],
    ['lower case', 'abcde-fghjk-mnpqr-stvwx'],
    ['spaced', 'ABCDE FGHJK MNPQR STVWX'],
    ['padded', '   ABCDE-FGHJK-MNPQR-STVWX   '],
    ['mixed separators', 'abcde fghjk-MNPQR stvwx'],
  ])('reads %s as the same code', (_label, input) => {
    expect(normaliseGiftCode(input)).toBe(canonical);
  });

  /**
   * The confusable letters map onto digits, and the mapping is SAFE because the alphabet excludes them.
   *
   * Somebody reading `0` off a printed card types `O` often enough that refusing it would look like a
   * broken card. `I` and `L` are the same story against `1`. Since no legitimate code contains `I`,
   * `L`, `O` or `U`, the mapping can never collide with a real symbol.
   */
  it.each([
    ['O', '0'],
    ['I', '1'],
    ['L', '1'],
    ['o', '0'],
    ['i', '1'],
    ['l', '1'],
  ])('maps %s onto %s', (typed, expected) => {
    expect(normaliseGiftCode(typed)).toBe(expected);
  });

  it('never emits a character outside the alphabet', () => {
    const noisy = normaliseGiftCode('  ab-cd_ef.gh/ij*kl 01 OO II LL  ');

    for (const symbol of noisy) {
      expect(GIFT_CODE_ALPHABET, `${symbol} is not in the alphabet`).toContain(symbol);
    }
  });

  it.each(['', '   ', '---', '!!!'])(
    'reduces %j to nothing rather than throwing',
    (input) => {
      expect(normaliseGiftCode(input)).toBe('');
    },
  );

  /* Idempotent: normalising an already-normalised code must not change it, or a re-hash would differ. */
  it('is idempotent', () => {
    const once = normaliseGiftCode('abcde-fghjk-mnpqr-stvwx');

    expect(normaliseGiftCode(once)).toBe(once);
  });

  /**
   * The alphabet is Crockford base32, and the four excluded letters are the point.
   *
   * If one of them were ever added, the digit mapping above would silently start corrupting codes that
   * legitimately contain it.
   */
  it.each(['I', 'L', 'O', 'U'])('excludes the confusable letter %s', (letter) => {
    expect(GIFT_CODE_ALPHABET).not.toContain(letter);
  });

  it('has a 32-symbol alphabet, so each symbol is five bits', () => {
    expect(GIFT_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(GIFT_CODE_ALPHABET).size).toBe(32);
    expect(GIFT_CODE_ENTROPY_BITS).toBe(GIFT_CODE_LENGTH * 5);
  });

  /**
   * 100 bits is the primary defence, and a rate limit is not a substitute.
   *
   * Shortening the code would trade the only protection that scales for typing convenience.
   */
  it('carries at least 100 bits of entropy', () => {
    expect(GIFT_CODE_ENTROPY_BITS).toBeGreaterThanOrEqual(100);
  });
});

describe('giftCardRedeemSchema', () => {
  it('accepts a code however it is grouped', () => {
    for (const input of [
      'ABCDE-FGHJK-MNPQR-STVWX',
      'abcdefghjkmnpqrstvwx',
      'ABCDE FGHJK MNPQR STVWX',
    ]) {
      expect(giftCardRedeemSchema.safeParse({ code: input }).success).toBe(true);
    }
  });

  /* A code of the wrong length cannot exist, so it is refused before it becomes a database lookup. */
  it.each(['', 'ABC', 'ABCDE-FGHJK', 'ABCDEFGHJKMNPQRSTVWXY'])(
    'refuses %j, which cannot be a code',
    (code) => {
      expect(giftCardRedeemSchema.safeParse({ code }).success).toBe(false);
    },
  );

  /* The upper bound is what stops a megabyte of text becoming a hash computation. */
  it('refuses an absurdly long string', () => {
    expect(giftCardRedeemSchema.safeParse({ code: 'A'.repeat(5_000) }).success).toBe(
      false,
    );
  });

  it('refuses an unknown field rather than ignoring it', () => {
    expect(
      giftCardRedeemSchema.safeParse({
        code: 'ABCDE-FGHJK-MNPQR-STVWX',
        customerId: 'somebody-else',
      }).success,
    ).toBe(false);
  });
});

describe('giftCardPurchaseSchema', () => {
  it('accepts a listed amount', () => {
    for (const amount of GIFT_CARD_AMOUNTS) {
      expect(giftCardPurchaseSchema.safeParse({ amount }).success).toBe(true);
    }
  });

  /**
   * The ladder is closed, and that is a liability decision rather than a UI one.
   *
   * A free-text amount is an arbitrary liability on the balance sheet, and it invites `0.01` and
   * `999999.99`, each needing its own rule.
   */
  it.each(['0.01', '999999.99', '30.00', '25', '-25.00', 'fifty'])(
    'refuses the unlisted amount %j',
    (amount) => {
      expect(giftCardPurchaseSchema.safeParse({ amount }).success).toBe(false);
    },
  );

  it('accepts an optional recipient', () => {
    const result = giftCardPurchaseSchema.safeParse({
      amount: '50.00',
      recipientName: '  ليلى  ',
      recipientEmail: 'laila@safra.test',
    });

    expect(result.success && result.data.recipientName).toBe('ليلى');
  });

  it('refuses a malformed recipient email', () => {
    expect(
      giftCardPurchaseSchema.safeParse({
        amount: '50.00',
        recipientEmail: 'not-an-email',
      }).success,
    ).toBe(false);
  });

  /**
   * No `currency` field.
   *
   * The card is issued in the currency of the wallet that paid for it. Letting the buyer name another
   * would mean converting at purchase and again at redemption — charging somebody twice for a spread
   * on their own money.
   */
  it('refuses a currency', () => {
    expect(
      giftCardPurchaseSchema.safeParse({ amount: '50.00', currency: 'EUR' }).success,
    ).toBe(false);
  });
});
