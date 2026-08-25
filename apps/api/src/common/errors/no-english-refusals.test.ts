import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * No refusal in the API is a hand-written English sentence (`O-api-2`).
 *
 * ## The rule this enforces, and why lint cannot
 *
 * "The API answers with an error CODE, not a sentence" is a standing decision (2026-08-04). The
 * `safra/no-hardcoded-text` lint rule cannot see these, because the prose is an ARGUMENT to a
 * constructor rather than JSX — so seven of them survived every `pnpm lint` from the day the rule
 * shipped until 2026-08-25, including one a paying customer met (an insufficient-balance 409) and
 * one every unenrolled staff member and partner met.
 *
 * `app-error.ts`'s helpers are the only way to build a refusal: they put the CODE in the body and
 * resolve the English `message` from the catalogue for logs. A sentence written at the throw site
 * cannot be translated, so whoever reads it reads English whatever language they chose.
 *
 * ## Zero, not a list
 *
 * There were no survivors when this was written, which is why it asserts an empty array rather than
 * carrying an allow-list. An allow-list here would be a place to add the eighth.
 *
 * ## Watched to fail
 *
 * Putting `throw new ConflictException('Wallet balance is too low.')` back into
 * `wallet.service.ts` reports that file by name. See the report.
 */
const API = join(import.meta.dirname, '..', '..');

/**
 * A NestJS exception constructed with prose.
 *
 * Matches a string or template-literal first argument. A bare `new NotFoundException()` is allowed
 * and is deliberate in one place — `metrics.controller.ts` answers 404 with no body at all when the
 * bearer token is absent or wrong, so that a scraper cannot tell those two apart. There is no
 * sentence in it to translate, and giving it a code would tell a prober that the endpoint exists.
 */
const PROSE_REFUSAL = /new\s+[A-Za-z]*Exception\(\s*(?:'|"|`)/;

/** Where the helpers live; its docblock quotes the old form in order to contrast it. */
const ALLOWED = new Set(['app-error.ts', 'no-english-refusals.test.ts', 'safe-error.ts']);

/** Comments and strings out, so a file explaining the rule is not reported for quoting it. */
function codeOnly(source: string): string {
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

describe('every refusal the API gives', () => {
  const offenders: string[] = [];

  for (const file of walk(API)) {
    const name = file.slice(file.lastIndexOf('/') + 1);

    if (ALLOWED.has(name) || name.includes('.test.') || name.includes('.spec.')) continue;

    if (PROSE_REFUSAL.test(codeOnly(readFileSync(file, 'utf8')))) {
      offenders.push(file.slice(API.length + 1));
    }
  }

  it('carries a code rather than an English sentence', () => {
    expect(offenders).toStrictEqual([]);
  });

  /**
   * The opposite control.
   *
   * The assertion above passes if the pattern matches nothing — a typo, a renamed directory, a
   * fourth way of spelling it — and the suite then reports a clean sweep of nothing at all.
   */
  it('recognises a prose refusal when it sees one', () => {
    for (const sample of [
      "throw new ConflictException('Wallet balance is too low.');",
      'throw new BadRequestException(`${key} must be positive.`);',
      'throw new ForbiddenException("Enrol first.");',
    ]) {
      expect(PROSE_REFUSAL.test(codeOnly(sample)), sample).toBe(true);
    }
  });

  it('leaves a body-less refusal and a coded one alone', () => {
    for (const sample of [
      'if (!expected) throw new NotFoundException();',
      'throw conflict(ERROR.WALLET_BALANCE_BELOW_AMOUNT, { balance, currency });',
      'throw badRequest(ERROR.SETTING_SCHEMA_NOT_EDITABLE, { key, schema });',
    ]) {
      expect(PROSE_REFUSAL.test(codeOnly(sample)), sample).toBe(false);
    }
  });
});
