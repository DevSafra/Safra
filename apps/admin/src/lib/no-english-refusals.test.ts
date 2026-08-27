import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A refusal from the API is resolved by its CODE, never by the English sentence beside it.
 *
 * ## The defect this generalises
 *
 * Bashar tried to create a campaign against an advertiser reference that does not exist. The API
 * answered exactly right — `400 advertiser.not_found`, and «المعلن غير موجود.» has been in the
 * Arabic catalogue since the domain was built. The screen said **«حدث خطأ ما. حاول مرة أخرى.»**
 *
 * Because the component read `payload.message` and handed it to `apiError`, which expects a CODE.
 * `advertiser.not_found` never reached the lookup; what reached it was the English sentence the
 * body carries for logs, which matches no key, so every refusal fell through to the generic
 * fallback — and «try again» is advice that could never work, on the one screen where the operator
 * needed to be told which field was wrong.
 *
 * ## Why a sweep and not a fix
 *
 * Because it was TEN components, not one — الكوبونات, بطاقات الهدايا, النزاعات, الرسائل, الوضع
 * الطارئ and الإعلانات all did it. `apiErrorOf` has existed for exactly this since 2026-08-24, and
 * `onboard-partner-form.tsx` carries a docblock explaining the mistake — five files used it and ten
 * went on making it, because the wrong shape is the one that gets copied from the file next door.
 *
 * A rule that lives in a comment in one component is not a rule.
 */
const SRC = join(import.meta.dirname, '..');

/**
 * Reading a `message` off a response body and treating it as a refusal.
 *
 * Not a bare `/\.message/`: a notification row, a zod issue and an `Error` all have one legitimately.
 * This names the idiom — narrowing a parsed response body to its `message` — which is only ever done
 * in order to show it to somebody.
 */
const SPELLINGS: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  {
    what: "'message' in payload — use apiErrorOf(payload)",
    pattern: /'message'\s+in\s+(?:payload|body|json|data|result)\b/,
  },
  {
    what: 'apiError(x.message) — the code is what resolves, not the sentence',
    pattern: /apiError\(\s*[\w.?]*\.message/,
  },
];

function walk(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) found.push(path);
  }

  return found;
}

/** Comments removed, so a file explaining the mistake is not accused of making it. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

describe('the console resolves a refusal by its code', () => {
  it('never reads the English message off a response body', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const name = file.slice(file.lastIndexOf('/') + 1);

      /*
        `strings.ts` is where `apiErrorOf` IS — it has to narrow a body to read both fields. The
        tests about it quote the idiom in order to recognise it. Neither is a screen.
      */
      if (name === 'strings.ts' || name.includes('.test.')) continue;

      const source = codeOnly(readFileSync(file, 'utf8'));

      for (const { what, pattern } of SPELLINGS) {
        if (pattern.test(source)) {
          offenders.push(`${file.slice(SRC.length + 1)} — ${what}`);
        }
      }
    }

    expect(
      offenders,
      'These show the API’s English sentence, or the generic fallback, instead of the Arabic for ' +
        'the code it answered. `apiErrorOf(payload)` reads `code` first and falls back to ' +
        '`message` only for the handful of routes that answer without one.',
    ).toStrictEqual([]);
  });

  /**
   * The opposite control.
   *
   * Every assertion above passes if the patterns match nothing — a renamed directory, a typo in a
   * regex, a fourth spelling. So each is asked to recognise the thing it is for, and to leave the
   * legitimate uses of `.message` alone.
   */
  it('recognises the idiom, and only the idiom', () => {
    const guilty = [
      "const m = typeof payload === 'object' && payload !== null && 'message' in payload;",
      'setError(apiError(payload.message));',
    ];

    expect(guilty).toHaveLength(SPELLINGS.length);

    for (const [index, sample] of guilty.entries()) {
      expect(SPELLINGS[index]?.pattern.test(sample), `sample ${index} missed`).toBe(true);
    }

    const innocent = [
      'setError(apiErrorOf(payload));',
      'const { message } = issue;',
      'return notice.message;',
      'logger.warn(describeError(error));',
    ].join('\n');

    for (const { pattern } of SPELLINGS) expect(pattern.test(innocent)).toBe(false);
  });
});
