/**
 * Blocks direct contact details in customer↔partner messages (SRS §10, design handoff §8).
 *
 * The rule: "يُمنع تبادل أرقام هواتف أو بيانات تواصل مباشرة قبل تأكيد الحجز، وتُحجب تلقائياً."
 * The business reason is not privacy theatre — a partner who moves a guest off-platform takes the
 * booking, the payment protection and SAFRA's ability to honour P-007 with them. So the platform
 * removes contact details rather than warning about them.
 *
 * ## What this deliberately does NOT do
 *
 * It does not claim to be unbeatable. Somebody determined to pass a phone number can spell it in
 * words, and no regex stops that. What it stops is the ordinary case — typing a number into a
 * chat box — which is what actually happens, and it does so visibly: the recipient sees that
 * something was removed, which is itself the deterrent.
 *
 * Treating this as a complete defence would be the mistake. It is one layer; the others are the
 * three-party thread that staff can read, and the partner score.
 *
 * ## The original is never kept
 *
 * `redact` returns only the cleaned text and a count. Storing the original alongside it would
 * recreate exactly the leak the rule exists to prevent — "we blocked it but kept a copy" is not
 * a rule, it is a different database column holding the same phone number.
 */

import { REDACTION_TOKEN, stripRedactionMarkers } from '@safra/i18n';

/**
 * Patterns, each anchored to something structural rather than to length alone.
 *
 * ## Order matters, and it is EMAIL BEFORE URL
 *
 * That ordering is not arbitrary. The URL pattern matches bare domains, so running it first eats
 * the domain out of an email and leaves the local part behind: `ahmad@x.com` became
 * `ahmad@⟨محجوب⟩`. The domain was gone, so the address was unusable — but the leak was real and
 * it looked like the rule half-worked, which is worse than either outcome.
 *
 * Found by probing the live endpoint, NOT by the test suite: the test asserted only that a mask
 * appeared and the count rose, both of which were true. The test now asserts the original string
 * is wholly absent, which is the property that actually matters.
 */
const PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  {
    /* First, so the whole address goes — see the ordering note above. */
    name: 'email',
    pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi,
  },
  {
    /*
      Includes bare domains, because "add me on wa.me/963…" carries a phone number inside a URL
      and would otherwise satisfy neither the URL nor the phone rule cleanly.
    */
    name: 'url',
    pattern: /\b(?:https?:\/\/|www\.)[^\s]+|\b[\w-]+\.(?:com|net|org|me|io|co)\b[^\s]*/gi,
  },
  {
    name: 'handle',
    /* `@username` for Telegram, Instagram and the like — but not an email, already removed. */
    pattern: /(?:^|\s)@[\w.]{3,}/g,
  },
  {
    name: 'phone',
    /**
     * Seven or more digits, allowing the separators people actually type.
     *
     * Seven is the floor because Syrian landlines are seven digits after the area code, and
     * because six or fewer is far more likely to be a price, a booking count or a year range.
     * A booking reference (`BKG-2026-000431`) is protected by requiring the run to not be
     * preceded by a letter — otherwise every reference in every message would be redacted,
     * which broke this on the first test.
     */
    pattern: /(?<![A-Za-z\d-])(?:\+?\d[\d\s().-]{5,}\d)(?![\d-])/g,
  },
] as const;

/**
 * What replaces a removed span: a language-neutral TOKEN, not a word.
 *
 * It used to be `contentMessages().redactionMask` — the Arabic «⟨محجوب⟩», because redaction happens
 * on the way into the database, where there is no reader to have a language. One stored string,
 * three possible readers, and a German customer opening a thread read Arabic (`O-i18n-2`).
 *
 * The token is stored; `renderRedactions` turns it into the reader's own word at the point of
 * display. Nothing else here changes: the original is still discarded, and the count is still what
 * the notice above a thread is built from.
 */
const MASK = REDACTION_TOKEN;

export interface Redaction {
  /** The message as it will be stored and shown. */
  readonly body: string;
  /** How many spans were removed. Zero for a clean message. */
  readonly redactedCount: number;
}

/**
 * Removes contact details from a message body.
 *
 * Idempotent: running it on already-redacted text changes nothing and reports zero, because the
 * token matches none of the patterns — which is why it is punctuation and carries no letters. That
 * matters because a message can be re-rendered.
 */
export function redactContactDetails(body: string): Redaction {
  let output = body;
  let count = 0;

  for (const { pattern } of PATTERNS) {
    /*
      A fresh RegExp per call. A module-level /g regex carries `lastIndex` between calls, so
      sharing one makes the SECOND message in a batch skip its first match — a bug that only
      appears under load and looks like intermittent leakage.
    */
    const scoped = new RegExp(pattern.source, pattern.flags);

    output = output.replace(scoped, (match) => {
      count += 1;

      /*
        Leading whitespace in the handle pattern is preserved, so "call @ahmad now" does not
        become "call⟦…⟧ now". Only the matched contact detail is replaced.
      */
      const leading = /^\s/.test(match) ? match[0] : '';

      return `${leading}${MASK}`;
    });
  }

  return { body: output, redactedCount: count };
}

/**
 * What a SERVICE calls on a body somebody just wrote: strip forged markers, then redact.
 *
 * ## Why this is a second function and not two lines inside the first
 *
 * They are different jobs and only one of them is idempotent.
 *
 * `redactContactDetails` is a pure transformation of text and running it on its own output must
 * change nothing — that is a documented guarantee, and the test above holds it. Stripping markers
 * cannot live inside it: on a second pass the marker in the text is OUR OWN, and removing it would
 * silently un-redact the message. That is not hypothetical; it is what the first version of this
 * change did, and the idempotence test caught it.
 *
 * Sanitising untrusted input, by contrast, is something you do EXACTLY ONCE, at the boundary — so
 * it belongs to the function the boundary calls.
 *
 * ## What the strip is for
 *
 * A writer pasting `⟦…⟧` would otherwise have it rendered to the recipient as «⟨محجوب⟩»: the
 * platform appearing to say it removed a phone number that was never there. Nothing leaks, but the
 * notice above a thread — "N contact details were removed" — is the reader's only signal for the
 * real thing, and a mask with no count behind it is what makes that signal worth less.
 *
 * Removed rather than counted: nothing was redacted, so `redactedCount` must not move.
 */
export function redactIncomingMessage(body: string): Redaction {
  return redactContactDetails(stripRedactionMarkers(body));
}

/** True when a body carries anything this module would remove. Used for warnings, not blocking. */
export function containsContactDetails(body: string): boolean {
  return redactContactDetails(body).redactedCount > 0;
}
