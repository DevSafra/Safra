import { describe, expect, it } from 'vitest';

import { count } from './format';
import { cancellationReason, payloadEntries, plural, roleName, t } from './strings';
import { ROLES } from '@safra/contracts';

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
  /**
   * An amount with no currency beside it is a number nobody can act on.
   *
   * Bashar read «المبلغ 200.00» on a booking's timeline (2026-08-25) and could not tell what it was
   * 200 of. On this platform that is not pedantry — SYP and USD differ by four orders of magnitude,
   * which is the same reason `bookingCompensationSchema` refuses an amount without one.
   */
  /**
   * Each amount takes its OWN currency when the payload states two.
   *
   * The defect this replaces was confidently wrong rather than merely missing. An SLA compensation
   * on a JOD booking paid into a USD wallet writes the fine and the compensation in the booking's
   * currency beside `creditedAmount` in the wallet's — deliberately, and the service comment says
   * so. `creditedCurrency` was in the general currency list, so it was found first and stamped on
   * all four: «الغرامة 10.000 USD» for a fine of 10.000 JOD.
   *
   * Watched to fail against the payload AS IT WAS WRITTEN — no general `currency` key at all, which
   * is what made `creditedCurrency` the only candidate. Restoring it to the general list turns
   * `fine` into `10.000 USD` in the case below, and the service now writes the booking's currency
   * so the paired case above it stays honest too.
   */
  it('never puts the wallet’s currency on the booking’s amounts', () => {
    const entries = payloadEntries({
      occurrence: 1,
      fine: '10.000',
      compensation: '10.000',
      currency: 'JOD',
      creditedAmount: '14.46',
      creditedCurrency: 'USD',
      walletBalance: '24.46',
      walletCurrency: 'USD',
    });

    const value = (key: string): string =>
      entries.find((entry) => entry.key === key)?.value ?? '';

    /* The booking's own figures, in the booking's currency. */
    expect(
      value('fine'),
      'the fine is what the PARTNER owes, in the booking currency',
    ).toBe('10.000 JOD');
    expect(value('compensation')).toBe('10.000 JOD');

    /* And the wallet's figures in the wallet's. */
    expect(value('creditedAmount'), 'what actually landed, in the wallet currency').toBe(
      '14.46 USD',
    );
    expect(value('walletBalance')).toBe('24.46 USD');

    /* Every currency row was attached to something, so none of them is repeated as its own row. */
    for (const key of ['currency', 'creditedCurrency', 'walletCurrency']) {
      expect(
        entries.some((entry) => entry.key === key),
        `«${key}» is on the amounts, so it does not also get a row`,
      ).toBe(false);
    }
  });

  /**
   * The payload exactly as `sla.service.ts` used to write it — no general currency.
   *
   * This is the shape that shipped. With nothing but `creditedCurrency` in the payload, a general
   * lookup finds it and stamps the WALLET's currency onto the partner's fine. The service now
   * writes `currency` as well, and this case pins the renderer's half: given no currency it can
   * trust for these two, it must print them bare rather than reach for the wallet's.
   */
  it('does not reach for the wallet currency when the booking states none', () => {
    const entries = payloadEntries({
      occurrence: 1,
      fine: '10.000',
      compensation: '10.000',
      creditedAmount: '14.46',
      creditedCurrency: 'USD',
      walletBalance: '24.46',
    });

    const value = (key: string): string =>
      entries.find((entry) => entry.key === key)?.value ?? '';

    expect(value('fine'), 'a JOD fine must never read as USD').toBe('10.000');
    expect(value('compensation')).toBe('10.000');
    /* Its own pair still reaches it. */
    expect(value('creditedAmount')).toBe('14.46 USD');
  });

  /**
   * A staff adjustment states what was asked and what was applied, and they can differ.
   *
   * `requestedAmount` is what the operator typed, in the currency they chose; `appliedAmount` and
   * `balance` are the wallet's. The pairing has to hold here too, or an adjustment reads as though
   * SAFRA moved a different number than it did.
   */
  it('separates what was requested from what the wallet took', () => {
    const entries = payloadEntries({
      balance: '109.29',
      currency: 'EUR',
      direction: 'credit',
      requestedAmount: '10.00',
      requestedCurrency: 'USD',
      appliedAmount: '9.29',
    });

    const value = (key: string): string =>
      entries.find((entry) => entry.key === key)?.value ?? '';

    expect(value('requestedAmount'), 'what the operator asked for').toBe('10.00 USD');
    expect(value('appliedAmount'), 'what the wallet took').toBe('9.29 EUR');
    expect(value('balance')).toBe('109.29 EUR');
  });

  /**
   * A money key with no currency anywhere still renders bare — the old behaviour, not a new one.
   *
   * The point of the pairing is to stop a WRONG currency being attached. It must not start
   * inventing one where the payload states none.
   */
  it('leaves an amount bare rather than borrowing an unrelated currency', () => {
    const entries = payloadEntries({ fine: '10.000', creditedCurrency: 'USD' });

    expect(entries.find((entry) => entry.key === 'fine')?.value).toBe('10.000');
    /* And the unattached currency keeps its own row, because it is the only place it appears. */
    expect(entries.some((entry) => entry.key === 'creditedCurrency')).toBe(true);
  });

  it('puts the payload currency on a money value', () => {
    const entries = payloadEntries({
      amount: '200.00',
      toWallet: '200.00',
      toProvider: '0.00',
      currency: 'USD',
    });

    for (const key of ['amount', 'toWallet', 'toProvider']) {
      expect(entries.find((e) => e.key === key)?.value, key).toMatch(/USD$/);
    }
  });

  /** Once it is on the amounts, the currency's own row is noise — the same fact twice. */
  it('drops the currency row once it has been attached', () => {
    const entries = payloadEntries({ amount: '200.00', currency: 'USD' });

    expect(entries.map((e) => e.key)).toEqual(['amount']);
    expect(entries[0]?.value).toBe('200.00 USD');
  });

  /** But keeps it where there is no amount to attach it to — there it is the only mention. */
  it('keeps the currency row when nothing money-shaped is beside it', () => {
    const entries = payloadEntries({ currency: 'USD', percent: 50 });

    expect(entries.map((e) => e.key)).toContain('currency');
  });

  /**
   * And NOT on the two numbers that are not money — the control that makes the test above mean
   * something.
   *
   * `percent` is a proportion and `rate` is an FX rate: 13000.00 is not thirteen thousand dollars.
   * A heuristic over "looks like a decimal" would have attached a currency to both, which is why
   * the money keys are a written list rather than a shape.
   */
  it('leaves a percentage and an exchange rate alone', () => {
    const entries = payloadEntries({
      percent: 100,
      rate: '13000.00',
      amount: '200.00',
      currency: 'USD',
    });

    expect(entries.find((e) => e.key === 'percent')?.value).not.toMatch(/USD/);
    expect(entries.find((e) => e.key === 'rate')?.value).not.toMatch(/USD/);
    expect(entries.find((e) => e.key === 'amount')?.value).toMatch(/USD$/);
  });

  /**
   * A payload written before the currency was recorded renders exactly as it does today.
   *
   * `audit_log` is append-only and every row predating 2026-08-25 has no currency key, so there is
   * nothing to backfill. Showing such an amount wearing a guessed currency would be worse than
   * showing it bare — an assumed currency on a money figure is how somebody refunds the wrong sum.
   */
  it('attaches nothing when the payload names no currency', () => {
    const [entry] = payloadEntries({ amount: '200.00' });

    expect(entry?.value).toBe('200.00');
  });

  /** A currency that is not an ISO code is not one — an id or a symbol must not be appended. */
  it('ignores a currency that is not a three-letter code', () => {
    for (const currency of ['us dollar', '$', '01a0-uuid', 'usd']) {
      const [entry] = payloadEntries({ amount: '200.00', currency });

      expect(entry?.value, currency).toBe('200.00');
    }
  });

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

/**
 * Every role the platform can put in an audit row has an Arabic name.
 *
 * ## Why the browser sweep was not enough
 *
 * `navigation.spec.ts` fails on snake_case Latin anywhere in the console, and it DID catch this —
 * but only once a `partner_employee` audit row happened to be near the top of سجل التدقيق, which
 * took an end-to-end walk to produce. `partner` and `customer` were missing for exactly as long
 * and had simply not been on a visible page. A sweep sees what is on screen; this sees the list.
 *
 * Driven off `ROLES`, which is derived from `ROLE_PERMISSIONS` — so adding a role to the platform
 * fails here until it has a name, rather than the day somebody with that role does something
 * audited.
 */
describe('roleName', () => {
  it('names every role the platform defines', () => {
    const unnamed = ROLES.filter((role) => roleName(role) === role);

    expect(unnamed).toStrictEqual([]);
  });

  /* The fallback is still the raw key: a missing translation must LOOK like one. */
  it('falls back to the raw value for a role that does not exist', () => {
    expect(roleName('not_a_role')).toBe('not_a_role');
  });
});
