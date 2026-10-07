import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * No money field is rendered straight into the customer site's markup (audit 2026-10-06).
 *
 * The account's front page printed `{booking.totalAmount}` as «200.00», with no currency, beside a
 * bookings list that printed the same booking through `formatMoney`. SAFRA prices in five
 * currencies, and SYP and USD differ by four orders of magnitude, so a bare figure is a number
 * nobody can act on (CLAUDE.md, «No amount is ever written without its currency»).
 *
 * ## What this sweep can and cannot see
 *
 * It looks for the SHAPE that produced the defect: a JSX child that is a member expression ending
 * in a money field (`{x.totalAmount}`, `{wallet.balance}`, `{unit.basePrice}`), which can only be a
 * raw decimal string. A value already formatted by `formatMoney` lives in a local variable or a
 * prop and is not matched. It is a floor, as the console's own `no-bare-amounts.test.ts` says of
 * itself: it cannot see a figure assembled into a sentence somewhere else.
 */
const SOURCE = join(import.meta.dirname, '..');

/** A JSX child `{a.b.someAmount}`, not an attribute value (`={…}`). */
const BARE_MONEY =
  /(?<![=\w$`])\{\s*[A-Za-z_$][\w$]*(?:\??\.[\w$]+)*\??\.(?:\w*[Aa]mount|balance|\w*[Bb]alance|\w*[Pp]rice|price)\s*\}/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) return sources(path);

    return entry.endsWith('.tsx') ? [path] : [];
  });
}

describe('every money figure on the customer site carries its currency', () => {
  const files = sources(SOURCE);

  it('finds source to check, so an empty sweep cannot pass', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('renders no money field as a bare decimal', () => {
    const bare = files.flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(BARE_MONEY)].map(
        (match) => `${path.replace(SOURCE, '')}: ${match[0]}`,
      ),
    );

    expect(
      bare,
      'These print a raw amount. Use `formatMoney(value, currency, locale)`, see «No amount is ' +
        'ever written without its currency» in CLAUDE.md.',
    ).toEqual([]);
  });

  it('recognises the shape it is looking for', () => {
    expect('<span>{booking.totalAmount}</span>'.match(BARE_MONEY)).not.toBeNull();
    expect('<span>{wallet?.balance}</span>'.match(BARE_MONEY)).not.toBeNull();
    expect('total={priced.totalAmount}'.match(BARE_MONEY)).toBeNull();
  });
});
