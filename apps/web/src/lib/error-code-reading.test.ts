import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A refusal is looked up by its CODE, never by the English sentence beside it.
 *
 * ## What this caught
 *
 * The checkout's coupon field read `body.message` and looked the result up in a map keyed by error
 * code. `message` is the API's English prose — `"This coupon does not apply to this property."` —
 * so the lookup missed on every refusal and fell through to the general «تعذّر تطبيق هذا الكود».
 * Every reason the API took care to distinguish was discarded at the last step.
 *
 * It was invisible for the reason these failures usually are: the fallback is a plausible sentence,
 * not a broken one. Nothing looked wrong; the screen simply stopped explaining itself. Bashar found
 * it by reading a screenshot of his own checkout on 2026-09-05.
 *
 * And it was the SECOND time — the console's partner onboarding carries a comment recording the
 * identical mistake, fixed there and never swept across. Which is what this test is for: the class,
 * in every app, rather than the instance.
 */
describe('reading a refusal from the API', () => {
  const APPS = ['apps/web/src', 'apps/partner/src', 'apps/admin/src'];

  function sources(): { file: string; source: string }[] {
    const out: { file: string; source: string }[] = [];

    function walk(dir: string): void {
      let entries;

      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const full = join(dir, entry.name);

        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.'))
          out.push({ file: full, source: readFileSync(full, 'utf8') });
      }
    }

    for (const app of APPS) walk(new URL(`../../../../${app}`, import.meta.url).pathname);

    return out;
  }

  it('never keys a message catalogue by body.message', () => {
    /*
      The shape of the defect: something derived from `body.message` used as an INDEX. A file that
      merely throws or logs the message is fine and common — `lib/api.ts` does exactly that, and
      carries the body alongside so a caller can still read the code.
    */
    const offenders = sources()
      .filter(({ source }) =>
        /(?:messages|copy\.messages|catalogue)\s*\[\s*[A-Za-z_$][\w$]*\s*\]/.test(source),
      )
      .filter(({ source }) =>
        /String\(\s*body\.message\s*\)|body\.message\b/.test(source),
      )
      .map(({ file }) => file.split('/').slice(-2).join('/'));

    expect(
      offenders,
      'These look a refusal up by its English sentence. The API answers a `code` beside that message, and the catalogues are keyed by it.',
    ).toStrictEqual([]);
  });
});
