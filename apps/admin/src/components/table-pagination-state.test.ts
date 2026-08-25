import { describe, expect, it } from 'vitest';

import { barState } from './table-pagination-state.js';

/**
 * Which controls the bar deactivates, and — the part that matters — which it does NOT.
 *
 * Bashar met the defect on a table with two rows: the arrows were correctly greyed and the page box
 * and تطبيق beside them were still live, inviting a request the table could not honour.
 *
 * `e2e/pagination.spec.ts` proves the `disabled` attribute reaches the DOM, and was watched to fail
 * without it. What it cannot prove is the twenty-five-rows-at-a-hundred case: whether any registry
 * on the development database holds between eleven and a hundred rows is an accident of the
 * fixtures, and the spec that looks for one SKIPS when there is none — which is what it did. This
 * asks the question directly instead.
 */
const SMALLEST = 10;

describe('which pagination controls can still do something', () => {
  it('deactivates everything on a table that fits in the smallest size', () => {
    /* Bashar's case: two rows. Every size shows both of them, and there is one page. */
    expect(
      barState({ pages: 1, total: 2, capped: false, smallestSize: SMALLEST }),
    ).toStrictEqual({ onlyPage: true, sizeIsMoot: true, nothingToApply: true });
  });

  it('keeps the size select alive on one page that is larger than the smallest size', () => {
    /*
      The case the browser suite cannot reach reliably, and the reason `sizeIsMoot` is not `pages
      <= 1`. Twenty-five rows shown at a hundred: one page, so the page controls are dead — but the
      select is the ONLY way back down to something scannable, and تطبيق has to stay live to submit
      it. A fix that disabled every control on any single-page table would pass every browser
      assertion and take this away.
    */
    expect(
      barState({ pages: 1, total: 25, capped: false, smallestSize: SMALLEST }),
    ).toStrictEqual({ onlyPage: true, sizeIsMoot: false, nothingToApply: false });
  });

  it('leaves every control alone on a table with more than one page', () => {
    expect(
      barState({ pages: 12, total: 300, capped: false, smallestSize: SMALLEST }),
    ).toStrictEqual({ onlyPage: false, sizeIsMoot: false, nothingToApply: false });
  });

  it('treats a capped total as never moot, because it is a floor and not a figure', () => {
    /*
      `capped` means the count stopped at `COUNT_CAP`, so `total` is "at least this many". Comparing
      it against a page size would be comparing the wrong number — and a capped table is at least
      10,000 rows, which is the furthest thing from one page there is.
    */
    expect(
      barState({ pages: 1, total: 10, capped: true, smallestSize: SMALLEST }).sizeIsMoot,
    ).toBe(false);
  });

  it('holds at the exact boundary, where an off-by-one would hide', () => {
    /* Ten rows at a size of ten: one screen, every option identical. Eleven: not. */
    expect(
      barState({ pages: 1, total: SMALLEST, capped: false, smallestSize: SMALLEST })
        .sizeIsMoot,
    ).toBe(true);
    expect(
      barState({ pages: 1, total: SMALLEST + 1, capped: false, smallestSize: SMALLEST })
        .sizeIsMoot,
    ).toBe(false);
  });

  it('deactivates nothing extra on an empty table', () => {
    /*
      Zero rows is one page and moot, so the controls are dead — correct, and worth pinning: an
      empty registry with a live page box invites a reader to look for rows on page two.
    */
    const state = barState({ pages: 1, total: 0, capped: false, smallestSize: SMALLEST });

    expect(state.nothingToApply).toBe(true);
  });
});
