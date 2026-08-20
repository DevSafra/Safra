import { describe, expect, it } from 'vitest';

import { COUNT_CAP } from '@safra/contracts';

import { count } from '@/lib/format';
import { fill, t } from '@/lib/strings';

/**
 * The toolbar note above الحجوزات must not print a capped figure as an exact one.
 *
 * ## Why this is a test and not a screenshot
 *
 * The per-status counts stop at `COUNT_CAP`, so their sum is a floor rather than a total. The rule is
 * explicit — "a capped total must NEVER be printed as an exact figure" — and until 2026-08-20 this
 * line printed «٥٠٠٠٠٦١ حجزًا», an exact number obtained from an uncapped full scan, directly above a
 * pagination bar correctly saying «أكثر من ١٠٠٠٠ نتيجة».
 *
 * The capped branch cannot be reached in a browser against the development fixtures: it needs more
 * than ten thousand bookings in a single status, and the fixture database holds a few thousand in
 * total. The uncapped branch runs in a browser on every `pnpm e2e` — `navigation.spec.ts` renders
 * this page — so this covers the half that cannot. Measured against `safra_load` the API answers
 * `total: 10000, capped: true`, which is the input asserted below.
 */
describe('the الحجوزات toolbar note', () => {
  /** The page's own choice of sentence, as `page.tsx` makes it. */
  const note = (byStatus: Record<string, number>, capped: boolean): string =>
    fill(capped ? t.sections.bookings.countAtLeast : t.sections.bookings.count, {
      n: count(Object.values(byStatus).reduce((sum, value) => sum + value, 0)),
    });

  it('says «أكثر من» when any status hit the cap', () => {
    const rendered = note(
      { confirmed: COUNT_CAP + 1, completed: COUNT_CAP + 1, pending_payment: 61 },
      true,
    );

    expect(rendered).toContain('أكثر من');
  });

  it('states a plain figure when nothing was capped', () => {
    const rendered = note({ confirmed: 120, completed: 900 }, false);

    expect(rendered).not.toContain('أكثر من');
    expect(rendered).toContain(count(1020));
  });

  /**
   * Both sentences keep the rest of the line.
   *
   * The note is not only a number — it also tells the reader every booking has a timeline, an audit
   * record and a reference (P-004). A capped variant that dropped that would quietly remove copy from
   * the screen for readers of large tables only, which is the hardest kind of loss to notice.
   */
  it('keeps the explanatory half in both forms', () => {
    for (const capped of [true, false]) {
      expect(note({ confirmed: COUNT_CAP + 1 }, capped)).toContain('P-004');
    }
  });

  /**
   * GROUPED western digits, which is the console's documented locale decision.
   *
   * "Arabic copy, western digits" was settled on 2026-08-06 and lives in `ARABIC_WESTERN_DIGITS`,
   * shared with لوحة الشريك — every figure on this console reconciles against a ledger, a bank
   * statement or a provider, and none of those render Arabic-Indic digits. So this asserts the
   * grouping `count()` applies, not a change of script: an ungrouped `10001` on screen is the
   * regression, because it means the figure bypassed the formatter.
   */
  it('renders the figure through the console’s number formatter', () => {
    const rendered = note({ confirmed: COUNT_CAP + 1 }, true);

    expect(rendered).toContain(count(COUNT_CAP + 1));
    expect(count(COUNT_CAP + 1), 'grouped, western').toBe('10,001');
    expect(rendered, 'an ungrouped figure means the formatter was skipped').not.toMatch(
      /(^|\D)10001(\D|$)/,
    );
  });
});
