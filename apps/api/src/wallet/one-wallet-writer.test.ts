import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `WalletService` is the ONLY thing that writes a balance or a wallet movement.
 *
 * ## Why this is a sweep and not a code review
 *
 * The wallet ADR states the rule and the rule was already broken when it was written down.
 * `dispute.service.ts` credited a wallet with its own `UPDATE wallets SET balance = balance + …`
 * beside a hand-written `INSERT INTO wallet_transactions`, and being a second writer is precisely
 * what let it carry two defects the primitive cannot have:
 *
 * - it added an amount in one currency to a balance denominated in another, because a wallet holds
 *   ONE currency for ever and only `WalletService` converts;
 * - it wrote nothing at all when the customer had no wallet row yet — the `UPDATE` matched
 *   nothing, the CTE was empty, the INSERT wrote zero rows, and no error was raised. 64% of live
 *   customers were in that state.
 *
 * Neither is reachable through `credit()`/`debit()`, which convert through SYP, lock the row,
 * compute `balance_after` in integer minor units and create the wallet on first use. So the
 * invariant is not a style preference: it is where every one of those guarantees lives.
 *
 * ## Production code, and the seeder named with its reason
 *
 * The first version of this swept the tests too, on the principle that a test writing a balance by
 * hand asserts against a state the application cannot produce. The sweep answered that with four
 * hits and three of them were right to exist: `wallet-adjustment-actor.integration.test.ts` has to
 * INSERT directly, because what it tests is the database CONSTRAINT rather than the service; two
 * others delete their own rows to clean up. Sweeping them buys nothing and would push the next
 * person to write a worse test.
 *
 * So this holds the invariant where it means something — the running system — and `seed-testbed.ts`
 * is named below because it builds fixture history in bulk and is not part of it. That exemption is
 * held to account rather than trusted: the assertion under it fails if the seeder ever stops being
 * a script and acquires a caller inside the API.
 */
const API = join(import.meta.dirname, '..');

/**
 * Writing a balance or a movement, in each spelling this codebase has used.
 *
 * Both the raw SQL and the drizzle builder, because the defect appeared as raw SQL and the next
 * one need not.
 */
const SPELLINGS: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  { what: 'UPDATE wallets', pattern: /\bUPDATE\s+wallets\b/i },
  {
    what: 'INSERT INTO wallet_transactions',
    pattern: /\bINSERT\s+INTO\s+wallet_transactions\b/i,
  },
  {
    what: 'DELETE FROM wallet_transactions',
    pattern: /\bDELETE\s+FROM\s+wallet_transactions\b/i,
  },
  { what: '.update(wallets)', pattern: /\.update\(\s*(?:schema\.)?wallets\s*\)/ },
  {
    what: '.insert(walletTransactions)',
    pattern: /\.insert\(\s*(?:schema\.)?walletTransactions\s*\)/,
  },
];

/** The one writer, and this file, which quotes the spellings in order to recognise them. */
const ALLOWED = new Set(['wallet.service.ts', 'one-wallet-writer.test.ts']);

/**
 * Bulk fixture history for `pnpm db:testbed`, run by hand against a development database.
 *
 * Exempt because it is not the running system. The assertion below keeps that true rather than
 * assuming it — an exemption whose reason has quietly stopped applying is the failure mode the
 * standing rule names, so this one is checked instead of written once.
 */
const SEEDER = 'scripts/seed-testbed.ts';

/**
 * Comments and string literals removed before matching — a file may DESCRIBE the rule.
 *
 * Lifted from `no-raw-error-messages.test.ts`, for the reason written there: a checker that cannot
 * tell code from the sentence explaining the code teaches people to stop writing the sentence.
 * `sql` templates are backtick strings, so they are stripped too — which is why the raw-SQL
 * spellings are matched against the ORIGINAL source and the builder spellings against the stripped
 * one.
 */
function commentsRemoved(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function walk(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }

  return found;
}

describe('the only writer of a wallet balance', () => {
  it('is WalletService, everywhere in the API', () => {
    const offenders: string[] = [];

    for (const path of walk(API)) {
      const name = path.split('/').pop() ?? '';

      if (ALLOWED.has(name)) continue;

      /* The invariant is about the running system; see the note on the seeder above. */
      if (name.endsWith('.test.ts')) continue;
      if (relative(API, path) === SEEDER) continue;

      const source = commentsRemoved(readFileSync(path, 'utf8'));

      for (const { what, pattern } of SPELLINGS) {
        if (pattern.test(source)) {
          offenders.push(`${relative(API, path)} — ${what}`);
        }
      }
    }

    expect(
      offenders,
      'These write a wallet balance or a movement directly. Go through `WalletService.credit()` ' +
        'or `.debit()`: the currency conversion, the row lock, the minor-unit arithmetic and the ' +
        'create-on-first-use all live there, and a second writer has none of them.',
    ).toStrictEqual([]);
  });

  /**
   * The seeder's exemption still describes something outside the running system.
   *
   * An exemption decays in the direction of hiding things: the reason is written once and the code
   * moves underneath it. `seed-testbed.ts` is exempt because nothing in the API imports it — the
   * moment something does, it IS the running system and the reason has stopped being true while
   * still reading as though it were.
   */
  it('keeps the seeder outside the API rather than merely excused', () => {
    const importers = walk(API)
      .filter((path) => relative(API, path) !== SEEDER)
      .filter((path) => !path.endsWith('.test.ts'))
      .filter((path) =>
        /from\s+'[^']*seed-testbed(?:\.js)?'/.test(readFileSync(path, 'utf8')),
      )
      .map((path) => relative(API, path));

    expect(
      importers,
      'The seeder writes wallet rows directly and is exempt only because it is a script nobody ' +
        'calls. Something in the API now calls it, so either it goes through `WalletService` or ' +
        'the exemption above is a lie.',
    ).toStrictEqual([]);
  });
});
