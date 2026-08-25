import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * No production file in the API takes a message off a caught error (`O-sec-7`).
 *
 * ## The defect this generalises
 *
 * `drizzle-orm` builds `DrizzleQueryError`'s message as `Failed query: <sql>\nparams: <the bound
 * VALUES>`. So `error.message` on a database failure IS personal data — verified live on 2026-08-20,
 * where a failing sign-in produced `params: someone@safra.test,1`; on any path that writes a `users`
 * row the same string carries the Argon2id hash and the encrypted TOTP secret.
 *
 * `safe-error.test.ts` proves `describeError` withholds them. This proves nothing goes round it.
 *
 * ## Why a sweep, and why there is no exemption list
 *
 * The instances were spread over twenty files, and deciding which are "on a database path" is a
 * judgement that decays. `partner-onboarding.service.ts` obviously is; `mail.service.ts` obviously
 * is not — until a mail template grows a lookup, and the reason written beside the exemption stays
 * true in words while the code moves underneath it. So there is no list. `describeError` is correct
 * for a non-database error too: it names the error, keeps the message and bounds the length.
 *
 * **FOUR columns stored the raw message before this** — `scheduled_job_runs.error`,
 * `payment_provider_events.processing_error`, `dead_letter_jobs.error` and
 * `notifications.failure_reason` — and the register had named only the first. A sweep found the other
 * three; a list of known sites could not have.
 */
const API = join(import.meta.dirname, '..', '..');

/**
 * Taking a message off a caught error, in each spelling this codebase has used.
 *
 * Not a bare `/\.message/`: `HttpException.message`, a zod issue's `message` and a notification
 * row's `message` are all legitimate and have nothing to do with a thrown error. These name the
 * idiom that carries a query — a catch binding, and the message read off it.
 */
const SPELLINGS: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  {
    what: 'error instanceof Error ? error.message : …',
    pattern: /(error|err|cause|exception|reason)\s+instanceof\s+Error\s*\?\s*\1\.message/,
  },
  {
    what: '(error as Error).message',
    pattern: /\((?:error|err|cause|exception)\s+as\s+Error\)\.message/,
  },
  {
    what: 'catch (e) { … e.message',
    pattern: /catch\s*\(\s*(\w+)\s*(?::[^)]*)?\)\s*\{[^}]{0,300}?\b\1\.message\b/s,
  },
];

/**
 * Where the shape is DEFINED, plus the two tests about it.
 *
 * Not an exemption list for production code — there is none, deliberately. `safe-error.ts` is the
 * implementation, `safe-error.test.ts` reproduces drizzle's own message as a fixture, and this file
 * quotes every spelling in order to recognise it.
 */
const ALLOWED = new Set([
  'safe-error.ts',
  'safe-error.test.ts',
  'no-raw-error-messages.test.ts',
]);

/**
 * Comments and string literals, removed before matching.
 *
 * The first version of this test flagged four files for their own PROSE — including the comment on
 * `job-run.service.ts` that reads "`describeError`, not `error.message`", which is the fix describing
 * itself. A checker that cannot tell code from the sentence explaining the code teaches people to
 * stop writing the sentence.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
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

describe('the API never logs or stores a raw error message', () => {
  const offenders: string[] = [];

  for (const file of walk(API)) {
    const name = file.slice(file.lastIndexOf('/') + 1);

    if (ALLOWED.has(name)) continue;

    /*
      Production source only.

      A test that reads `error.message` to assert on it is not a leak: it runs against fixtures, on a
      development database, and its output goes to whoever ran it. That is a statement of SCOPE, not
      an exemption — the question "which production file may do this" has no answers, which is why
      there is no list of them.
    */
    if (name.includes('.test.') || name.includes('.spec.')) continue;

    const source = codeOnly(readFileSync(file, 'utf8'));

    for (const { what, pattern } of SPELLINGS) {
      if (pattern.test(source)) offenders.push(`${file.slice(API.length + 1)} — ${what}`);
    }
  }

  it('takes its description from describeError instead', () => {
    expect(offenders).toStrictEqual([]);
  });

  /**
   * The opposite control, and the reason this file is not a no-op.
   *
   * Every assertion above passes if the patterns match nothing — a typo in a regex, a renamed
   * directory, an idiom spelled a fourth way — and the suite then reports a clean sweep of nothing
   * at all. So each pattern is asked to recognise the thing it is for, before AND after the comment
   * stripper, because a stripper that ate the code would have the same effect as a broken pattern.
   */
  it('recognises every spelling it claims to', () => {
    const samples = [
      'const m = error instanceof Error ? error.message : String(error);',
      'log((error as Error).message);',
      'try { go(); } catch (oops) { this.logger.error(oops.message); }',
    ];

    expect(samples).toHaveLength(SPELLINGS.length);

    for (const [index, sample] of samples.entries()) {
      const spelling = SPELLINGS[index];

      expect(spelling, `no pattern for sample ${index}`).toBeDefined();
      expect(spelling?.pattern.test(sample), `${spelling?.what} missed its sample`).toBe(
        true,
      );
      expect(
        spelling?.pattern.test(codeOnly(sample)),
        `${spelling?.what} missed its sample after stripping`,
      ).toBe(true);
    }
  });

  it('does not fire on a message that has nothing to do with a thrown error', () => {
    const innocent = [
      'throw badRequest(ERROR.X, { message: label });',
      'const { message } = issue;',
      'return { message: row.message };',
      'if (exception instanceof HttpException) return exception.getResponse();',
    ].join('\n');

    for (const { pattern } of SPELLINGS) expect(pattern.test(innocent)).toBe(false);
  });
});
