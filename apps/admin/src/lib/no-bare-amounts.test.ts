import { describe, expect, it } from 'vitest';

import { t } from './strings';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No amount is written without its currency — Bashar's standing rule of 2026-08-25.
 *
 * ## What this sweep can and cannot see
 *
 * `money()` formats a NUMBER. It is correct only where a currency sits beside it in the same
 * visual unit, and the failure is silent: «المبلغ 200.00» reads like a complete answer and is not
 * one, because SAFRA prices in five currencies and SYP and USD differ by four orders of magnitude.
 *
 * So this reads every `money(` call site and looks for a currency NEAR it — the next span, a
 * `{currency}` placeholder, a literal «ل.س». That is a heuristic over source text and it is a
 * FLOOR, not a ceiling: it cannot see a currency assembled three components away, and it cannot see
 * an amount built without `money()` at all. What it does catch is the shape that produced the
 * defect — `money(x)` with nothing beside it, and `{currency ?? ''}`, which reads as handled and
 * renders a bare number in exactly the case nobody can interpret.
 *
 * ## Why a source sweep rather than a type
 *
 * The obvious structural answer is to delete `money()` and leave only `amount(value, currency)`.
 * It is the wrong one: a template like «استُرد {amount} {currency}» needs the number and the code
 * as separate placeholders so a translator can order them, and «= {money(rate)} ل.س» carries its
 * currency as a word. Both are correct and neither can be expressed by a formatter that always
 * appends. The rule is about what a READER sees, which is why the check looks at the rendering.
 */
const SOURCE = join(import.meta.dirname, '..');

/** Anything within this many characters counts as "beside it" for a currency. */
const NEARBY = 120;

/**
 * What proves a currency is present.
 *
 * `ل.س` and `$` are literals some screens carry instead of a code; `{currency}` and `{currencyCode}`
 * are the template placeholders; `currency`/`currencyCode`/`walletCurrency` cover a sibling
 * expression. `DEFAULT_MONEY_CURRENCY` is the sanctioned fallback for a row that has none.
 */
const CURRENCY = [
  /\bcurrency\b/i,
  /\bcurrencyCode\b/,
  /DEFAULT_MONEY_CURRENCY/,
  /ل\.س/,
  /\{currency\}/,
  /\$\{/,
  /'\$'/,
];

/**
 * The shape that reads as handled and is not.
 *
 * `{currency ?? ''}` renders an empty string precisely when the row has no currency, which is the
 * one case where the number alone is uninterpretable. Named separately from the proximity check
 * because a currency IS nearby — it is just empty.
 */
const EMPTY_FALLBACK = /currency\w*\s*\?\?\s*''/;

/**
 * The catalogue messages a `fill(t.…)` in this window refers to, resolved.
 *
 * Without this the sweep cannot see «{amount} ل.س بسعر صرف {rate}» — the currency is a word in the
 * MESSAGE, and the call site names only a key. That is a correct rendering and the heuristic was
 * about to call it a defect, which is the fastest way to have a sweep switched off.
 *
 * Resolving it makes the check stronger rather than weaker: a template that carries an amount and
 * no currency now fails from the call site, which is where somebody would look.
 */
function templateNames(window: string): string[] {
  const catalogue = t as unknown as Record<string, unknown>;

  return [...window.matchAll(/\bt\.([\w.]+)/g)].flatMap((match) => {
    const resolved = (match[1] ?? '')
      .split('.')
      .reduce<unknown>(
        (node, key) =>
          typeof node === 'object' && node !== null
            ? (node as Record<string, unknown>)[key]
            : undefined,
        catalogue,
      );

    return typeof resolved === 'string' ? [resolved] : [];
  });
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) return sources(path);

    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe('every rendered amount carries its currency', () => {
  const files = sources(SOURCE).filter((path) => !path.endsWith('format.ts'));

  it('finds source to check, so an empty sweep cannot pass', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('has no money() with no currency beside it', () => {
    const bare: string[] = [];

    for (const path of files) {
      const source = readFileSync(path, 'utf8');

      for (const match of source.matchAll(/\bmoney\(/g)) {
        const from = Math.max(0, (match.index ?? 0) - NEARBY);
        const window = source.slice(from, (match.index ?? 0) + NEARBY);

        if (
          !CURRENCY.some((pattern) => pattern.test(window)) &&
          !templateNames(window).some((message) =>
            CURRENCY.some((pattern) => pattern.test(message)),
          )
        ) {
          bare.push(`${path.replace(SOURCE, '')}: ${window.replace(/\s+/g, ' ').trim()}`);
        }
      }
    }

    expect(
      bare,
      'These render a number with no currency near it. Use `amount(value, currency)`, or put the ' +
        'currency beside it — see «No amount is ever written without its currency» in CLAUDE.md.',
    ).toEqual([]);
  });

  it('never falls back to an empty currency', () => {
    const holes = files.filter((path) => EMPTY_FALLBACK.test(readFileSync(path, 'utf8')));

    expect(
      holes.map((path) => path.replace(SOURCE, '')),
      "`currency ?? ''` renders a bare number exactly where nobody can interpret it. " +
        '`DEFAULT_MONEY_CURRENCY` is the fallback.',
    ).toEqual([]);
  });
});
