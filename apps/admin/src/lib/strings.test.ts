import { describe, expect, it } from 'vitest';

import { count } from './format';
import { cancellationReason, payloadEntries, plural, t } from './strings';

/**
 * A cancellation reason is either a `system.*` code or a person's own sentence, and the two are
 * distinguished only by whether the catalogue knows the value.
 *
 * The Arabic console printed "Payment not completed within the allowed window (EC-001)." because
 * the platform's own cancellations stored an English sentence (Bashar, 2026-08-06). They store a
 * code now — but the fallback carries as much weight as the lookup, so both are pinned here.
 */
describe('cancellationReason', () => {
  it('resolves the three the platform decides for itself', () => {
    expect(cancellationReason('system.payment_expired')).toContain('EC-001');
    expect(cancellationReason('system.payment_expired')).not.toMatch(/[A-Za-z]{4}/);
    expect(cancellationReason('system.partner_no_response')).not.toMatch(/[A-Za-z]{4}/);
    expect(cancellationReason('system.partner_rejected')).not.toMatch(/[A-Za-z]{4}/);
  });

  /**
   * Verbatim, NOT `replace(/_/g, ' ')` like the enum lookups do. A reason somebody typed is their
   * statement about a booking, and a resolver that rewrote its underscores would be editing it.
   */
  it('returns a typed reason exactly as written', () => {
    const typed = 'Customer called — double_booked at the property, refunded in full.';

    expect(cancellationReason(typed)).toBe(typed);
  });

  /**
   * Rows written before the codes existed still hold English, and still have to render. This is
   * what makes the change need no migration.
   */
  it('still shows a legacy English row rather than swallowing it', () => {
    const legacy = 'Partner did not respond within the confirmation window (§6.4).';

    expect(cancellationReason(legacy)).toBe(legacy);
  });
});

/**
 * A timeline payload, which used to be printed as raw JSON: the booking screen showed
 * `{"reason":"EC-001"}` under «الخط الزمني» (Bashar, 2026-08-06).
 *
 * The rule these pin is "translate what is a code, keep everything else, drop nothing" — the
 * payload is on screen because a dispute can turn on which fine was applied.
 */
describe('payloadEntries', () => {
  it('turns a code into a sentence a support agent can act on', () => {
    const [entry] = payloadEntries({ reason: 'EC-001' });

    expect(entry?.label).toBe('السبب');
    expect(entry?.value).not.toBe('EC-001');
    expect(entry?.value).not.toMatch(/[A-Za-z]{4}/);
  });

  /** Every field survives, including one the catalogue has never seen. */
  it('keeps a field it does not recognise instead of dropping it', () => {
    const entries = payloadEntries({ occurrence: 2, somethingNew: 'x-42' });

    expect(entries).toHaveLength(2);
    expect(entries[1]).toStrictEqual({
      key: 'somethingNew',
      label: 'somethingNew',
      value: 'x-42',
    });
  });

  /** A reason someone typed is not a code and passes through untouched. */
  it('leaves a typed reason alone', () => {
    expect(payloadEntries({ reason: 'Changed plans' })[0]?.value).toBe('Changed plans');
  });

  /** Nested values are re-serialised rather than flattened — flattening is where a field goes. */
  it('serialises a nested value rather than losing it', () => {
    expect(payloadEntries({ tiers: [{ days: 7 }] })[0]?.value).toBe('[{"days":7}]');
  });

  it('has nothing to show for an empty or absent payload', () => {
    expect(payloadEntries({})).toStrictEqual([]);
    expect(payloadEntries(null)).toStrictEqual([]);
    expect(payloadEntries('not an object')).toStrictEqual([]);
  });
});

/**
 * Arabic agreement in the console, at the boundaries that break it.
 *
 * The console printed «٤ ليلة» on the booking detail — correct for one night, wrong for four — on
 * a screen an operator reads all day. `fill` could not fix it: it substitutes placeholders, and
 * agreement is not substitution.
 */
describe('plural', () => {
  it('gives one, two, few, many and other their own wording', () => {
    const rendered = [1, 2, 3, 15, 100].map((n) => plural(t.table.found, { n }));

    expect(new Set(rendered).size).toBe(5);
  });

  /* The case `other` used to swallow: 11–99 takes the SINGULAR noun in Arabic. */
  it('uses the singular for 11 to 99', () => {
    expect(plural(t.table.found, { n: 15 })).toContain('نتيجة');
    expect(plural(t.table.found, { n: 15 })).not.toContain('نتائج');
    expect(plural(t.table.found, { n: 5 })).toContain('نتائج');
  });

  it('agrees on the booking stay line, which names two counts at once', () => {
    const line = plural(t.sections.bookingDetail.stay, {
      checkIn: '2026-08-01',
      checkOut: '2026-08-05',
      nights: 4,
      adults: 2,
    });

    expect(line).toContain('ليالٍ');
    expect(line).toContain('بالغان');
    /* The defect, pinned: four nights is never «٤ ليلة». */
    expect(line).not.toMatch(/٤ ليلة/);
  });

  /**
   * The digits match the rest of the console, and the count arrives as a NUMBER.
   *
   * `count()` formats with `ARABIC_WESTERN_DIGITS` — the console shows Western numerals in Arabic
   * copy deliberately — so ICU must agree, or one figure on a screen would be written differently
   * from the one beside it.
   *
   * Passing `count(n)` instead of `n` would give `Intl.PluralRules` nothing numeric to classify,
   * and every message would silently resolve to `other`. The five-distinct-forms test above is
   * what would catch that; this one keeps the two number styles in step.
   */
  it('formats its digits the same way the rest of the console does', () => {
    expect(plural(t.table.found, { n: 5 })).toContain(count(5));
    expect(plural(t.table.found, { n: 1500 })).toContain(count(1500));
  });
});
