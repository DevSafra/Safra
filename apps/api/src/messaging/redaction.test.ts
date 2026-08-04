import { describe, expect, it } from 'vitest';

import { containsContactDetails, redactContactDetails } from './redaction.js';

/**
 * Contact-detail blocking in customer↔partner threads (SRS §10, design handoff §8).
 *
 * ## Both directions are failures
 *
 * A pattern that misses a phone number lets a partner take the booking off-platform. A pattern
 * that is too greedy eats the booking reference out of every message, which makes the thread
 * useless and — worse — teaches staff to ignore the mask. So the false-positive cases below carry
 * as much weight as the true positives, and each one is a real string that appears in these
 * threads.
 */
describe('redacting contact details', () => {
  describe('removes what it must', () => {
    /** `[what, message, the exact substring that must not survive]` */
    const blocked: readonly [string, string, string][] = [
      ['a local mobile', 'اتصل بي على 0944 123 456', '0944 123 456'],
      ['an international number', 'my number is +963 944 123456', '+963 944 123456'],
      ['a bare digit run', 'call 0111234567 tonight', '0111234567'],
      ['a number with separators', 'reach me on (011) 223-4455', '(011) 223-4455'],
      ['an email address', 'email me at ahmad.hotel@gmail.com', 'ahmad.hotel@gmail.com'],
      // The local part too — this is the case that was leaking.
      ['a short email address', 'write to ahmad@x.com now', 'ahmad@x.com'],
      ['a URL', 'see https://wa.me/963944123456 for details', 'wa.me/963944123456'],
      ['a bare domain', 'book direct at qasr-alsharq.com and save', 'qasr-alsharq.com'],
      ['a social handle', 'find us @qasralsharq on instagram', '@qasralsharq'],
    ];

    for (const [what, body, secret] of blocked) {
      it(what, () => {
        const result = redactContactDetails(body);

        expect(result.redactedCount).toBeGreaterThan(0);
        expect(result.body).toContain('⟨محجوب⟩');
        expect(containsContactDetails(body)).toBe(true);

        /*
          The contact detail must be WHOLLY gone, not merely damaged.

          The original version of this test asserted only that a mask appeared and the count rose.
          Both were true while `ahmad@x.com` was being stored as `ahmad@⟨محجوب⟩` — the URL pattern
          ate the domain before the email pattern saw it, and the local part leaked. The bug was
          found by probing the live endpoint, which is exactly the gap this assertion closes.
        */
        expect(result.body).not.toContain(secret);
      });
    }

    it('removes several in one message and counts each', () => {
      const result = redactContactDetails('call 0944123456 or email me@x.com');

      expect(result.redactedCount).toBe(2);
      expect(result.body).not.toMatch(/0944123456|me@x\.com/);
    });
  });

  describe('leaves alone what it must', () => {
    /**
     * Every one of these is a string that genuinely appears in a SAFRA thread. The booking
     * reference is the important one: `BKG-2026-000431` contains a ten-digit run once the hyphens
     * are ignored, and an earlier version of the phone pattern redacted it out of every single
     * message — which is how the negative lookbehind on letters and hyphens got there.
     */
    const allowed: readonly [string, string][] = [
      ['a booking reference', 'بخصوص الحجز BKG-2026-000431'],
      ['a dispute reference', 'opened DSP-000112 for you'],
      ['a partner reference', 'PAR-000042 confirmed the dates'],
      ['a payment reference', 'PAY-004215 was captured'],
      ['a price', 'المبلغ 272 دولاراً لثلاث ليالٍ'],
      ['a larger price', 'the total is 3,118,050 SYP'],
      ['a date range', 'from 25 to 28 July 2026'],
      ['a room number', 'غرفة 204، الطابق الثاني'],
      ['a plain sentence', 'نتواصل مع الشريك وسنعود إليك خلال ساعة.'],
    ];

    for (const [what, body] of allowed) {
      it(what, () => {
        const result = redactContactDetails(body);

        expect(result.redactedCount, `redacted: ${result.body}`).toBe(0);
        expect(result.body).toBe(body);
      });
    }
  });

  /**
   * Idempotent, because a message can be re-rendered or re-processed.
   *
   * If the mask itself tripped a pattern, the count would grow every pass and the body would fill
   * with nested masks.
   */
  it('is idempotent', () => {
    const once = redactContactDetails('call 0944123456');
    const twice = redactContactDetails(once.body);

    expect(twice.body).toBe(once.body);
    expect(twice.redactedCount).toBe(0);
  });

  /**
   * Regression guard for shared regex state.
   *
   * A module-level `/g` RegExp carries `lastIndex` between calls, so the SECOND message in a
   * batch skips its first match — intermittent leakage that only appears under load. Calling
   * repeatedly with the same input must give the same answer every time.
   */
  it('does not carry regex state between calls', () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(redactContactDetails('call 0944123456').redactedCount).toBe(1);
    }
  });

  it('preserves the space before a redacted handle', () => {
    const result = redactContactDetails('follow @safraofficial today');

    // Not "follow⟨محجوب⟩ today" — only the handle is replaced.
    expect(result.body).toBe('follow ⟨محجوب⟩ today');
  });

  it('handles an empty body without throwing', () => {
    expect(redactContactDetails('')).toStrictEqual({ body: '', redactedCount: 0 });
  });
});
