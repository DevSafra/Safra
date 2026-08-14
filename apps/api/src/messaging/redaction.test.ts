import { describe, expect, it } from 'vitest';

import { REDACTION_TOKEN, renderRedactions } from '@safra/i18n';

import {
  containsContactDetails,
  redactContactDetails,
  redactIncomingMessage,
} from './redaction.js';

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
        /* The TOKEN, not a word: the language is chosen by the reader, not by the writer. */
        expect(result.body).toContain(REDACTION_TOKEN);
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

    // Not "follow⟦…⟧ today" — only the handle is replaced.
    expect(result.body).toBe(`follow ${REDACTION_TOKEN} today`);
  });

  it('handles an empty body without throwing', () => {
    expect(redactContactDetails('')).toStrictEqual({ body: '', redactedCount: 0 });
  });
});

/**
 * `O-i18n-2`: the stored body carries no language, so every reader gets their own.
 *
 * The bug this closes: the mask was written INTO the row in `DEFAULT_LOCALE`, so a German customer
 * opening a thread a Syrian partner had written read «⟨محجوب⟩». One stored string, three readers.
 */
describe('the mask follows the reader, not the writer', () => {
  const redacted = (body: string) => redactContactDetails(body).body;

  it('stores a token that names no language', () => {
    const body = redacted('call 0944123456 please');

    expect(body).toContain(REDACTION_TOKEN);
    /* None of the three words is in the row — that is the whole change. */
    expect(body).not.toContain('محجوب');
    expect(body).not.toContain('redacted');
    expect(body).not.toContain('entfernt');
  });

  it.each([
    ['ar', '⟨محجوب⟩'],
    ['en', '⟨redacted⟩'],
    ['de', '⟨entfernt⟩'],
  ] as const)('renders in %s for that reader', (locale, mask) => {
    expect(renderRedactions(redacted('call 0944123456 please'), locale)).toBe(
      `call ${mask} please`,
    );
  });

  /**
   * Bodies written BEFORE the token still render for their reader.
   *
   * `messages` is append-only — `deny_mutation` raises on UPDATE — so those rows cannot be
   * migrated, and a renderer that only knew the token would leave every thread written before
   * 2026-08-14 showing Arabic to a German customer. Which is the bug, still there, just older.
   */
  it.each([
    ['ar', '⟨محجوب⟩'],
    ['en', '⟨redacted⟩'],
    ['de', '⟨entfernt⟩'],
  ] as const)('renders a legacy Arabic mask in %s', (locale, mask) => {
    expect(renderRedactions('call ⟨محجوب⟩ please', locale)).toBe(`call ${mask} please`);
  });

  it('leaves a body with nothing removed exactly as it is', () => {
    expect(renderRedactions('a perfectly ordinary sentence', 'de')).toBe(
      'a perfectly ordinary sentence',
    );
  });

  /**
   * A writer cannot forge a redaction.
   *
   * Pasting the token would otherwise render to the recipient as «⟨محجوب⟩» — the platform seeming
   * to say it removed a phone number that was never there, which devalues the notice above the
   * thread. The marker is stripped and the count does not move, because nothing was removed.
   */
  it('strips a marker the writer typed, and does not count it', () => {
    const result = redactIncomingMessage(`I wrote ${REDACTION_TOKEN} myself`);

    expect(result.redactedCount).toBe(0);
    expect(result.body).toBe('I wrote  myself');
    expect(renderRedactions(result.body, 'ar')).not.toContain('محجوب');
  });

  it('strips a legacy mask the writer typed', () => {
    const result = redactIncomingMessage('I wrote ⟨محجوب⟩ myself');

    expect(result.redactedCount).toBe(0);
    expect(renderRedactions(result.body, 'en')).not.toContain('redacted');
  });

  /* And it still redacts, so the strip did not replace the job it sits in front of. */
  it('redacts as well as strips', () => {
    const result = redactIncomingMessage(`${REDACTION_TOKEN} call 0944123456`);

    expect(result.redactedCount).toBe(1);
    expect(result.body).toContain(REDACTION_TOKEN);
    expect(result.body).not.toContain('0944123456');
  });

  /**
   * The reason the strip is NOT inside `redactContactDetails`.
   *
   * On a second pass the marker in the text is our own, so a function that stripped it would
   * silently un-redact the message. The first version of this change did exactly that, and this is
   * the property that caught it.
   */
  it('leaves a body it has already redacted untouched', () => {
    const once = redacted('email ahmad@x.com now');
    const twice = redactContactDetails(once);

    expect(twice.redactedCount).toBe(0);
    expect(twice.body).toBe(once);
    expect(twice.body).toContain(REDACTION_TOKEN);
  });
});
