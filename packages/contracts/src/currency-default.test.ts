import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_MONEY_CURRENCY, preferredCurrency } from './booking.js';
import { CURRENCY_CATALOGUE } from './currency-catalogue.js';

/**
 * USD is what a picker starts on, everywhere, in every app (Bashar, 2026-08-30).
 *
 * The failure this prevents is silent and expensive: `GIFT_CARD_CURRENCIES` is written SYP-first
 * and the geography read orders the ACCOUNTING currency first, so a form defaulting to
 * `currencies[0]` denominated a gift card or a coupon in SYP whenever nobody touched the select —
 * a figure four orders of magnitude away from the one that was meant.
 */
describe('preferredCurrency', () => {
  it('picks the standard currency wherever it is in the list', () => {
    expect(preferredCurrency(['SYP', 'USD', 'EUR'])).toBe(DEFAULT_MONEY_CURRENCY);
    expect(preferredCurrency(['USD', 'EUR'])).toBe(DEFAULT_MONEY_CURRENCY);
  });

  it('falls back to what is offered when the standard one is not', () => {
    expect(preferredCurrency(['EUR', 'SYP'])).toBe('EUR');
  });

  it('answers the standard currency rather than nothing for an empty list', () => {
    expect(preferredCurrency([])).toBe(DEFAULT_MONEY_CURRENCY);
  });
});

/**
 * And that every form ACTUALLY calls it.
 *
 * The tests above prove `preferredCurrency` returns the right answer. They said nothing about the
 * two payout forms that never asked it: the partner's payout account and the treasury's SAFRA
 * destination each wrote `'SYP'` for their initial value, months after the rule was set, and one of
 * them had no currency control at all — a SAFRA account could only ever be recorded in Syrian
 * pounds. A helper test proves the helper works; this is the one that would have caught them.
 *
 * The pattern searched for is a currency INITIALISED to a quoted code. That is the shape the defect
 * takes every time, and it is narrow enough not to fire on the accounting currency, which is a
 * constant rather than a default anybody may change.
 */
describe('the forms that pick a currency', () => {
  const APPS = ['apps/admin/src', 'apps/partner/src', 'apps/web/src'];

  /** Every `.tsx` under the three apps. */
  function screens(): { file: string; source: string }[] {
    const out: { file: string; source: string }[] = [];

    function walk(dir: string): void {
      let entries;

      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        /* An app not checked out here is not a breach of this rule. */
        return;
      }

      for (const entry of entries) {
        const full = join(dir, entry.name);

        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.'))
          out.push({ file: full, source: readFileSync(full, 'utf8') });
      }
    }

    for (const app of APPS) walk(new URL(`../../../${app}`, import.meta.url).pathname);

    return out;
  }

  it('never hardcode which currency a form starts on', () => {
    const codes = CURRENCY_CATALOGUE.map((one) => one.code).join('|');
    /* A line that both names a currency and writes one down. */
    const hardcoded = new RegExp(`currency[^\n]*'(?:${codes})'`, 'i');

    const offenders = screens()
      .flatMap(({ file, source }) =>
        source
          .split('\n')
          .filter(
            (line) =>
              hardcoded.test(line) &&
              /* Prose about the rule is not a breach of it, and the unit of account is a constant. */
              !/^\s*(?:\*|\/\/)/.test(line) &&
              !line.includes('ACCOUNTING_CURRENCY'),
          )
          .map(() => file.split('/').slice(-3).join('/')),
      )
      .filter((file, index, all) => all.indexOf(file) === index);

    expect(
      offenders,
      `These pick a currency by writing its code. Use preferredCurrency() from @safra/contracts, so a form nobody touches produces ${DEFAULT_MONEY_CURRENCY} rather than whichever code got typed.`,
    ).toStrictEqual([]);
  });
});
