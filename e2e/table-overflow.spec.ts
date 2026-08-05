import { expect, test, type Page } from '@playwright/test';

import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * No cell paints over the column beside it.
 *
 * ## Why this exists
 *
 * `AdminTable` is `table-fixed` with `<col>` percentages, so a column's width is decided by the
 * design's template and NOT by its content. A cell whose content is wider than its column does not
 * widen it and is not clipped either — it spills into the neighbour and the two are drawn on top
 * of each other. That is what the bookings table did: `04-09-2026 ← 08-09-2026` was 159px of
 * `whitespace-nowrap` content in a 133px column, so the check-in date and `201.99 USD` were
 * printed over one another and neither was readable.
 *
 * ## Why a browser and why every width
 *
 * Nothing below a browser measures a rendered glyph. And the failure is width-dependent: the same
 * table is fine at 1920 and broken at 1024, so a single viewport proves nothing. The widths below
 * bracket the `minWidth` floor at which each table starts scrolling inside its own box — above the
 * floor the columns shrink with the window, which is where the collision appears.
 *
 * ## Why it reports every offender at once
 *
 * A per-table assertion stops at the first failure. The useful output is the LIST, because the
 * cause is usually one shared formatter rather than one table.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.use({ storageState: STAFF_STATE });

const SECTIONS = [
  '/bookings',
  '/partners',
  '/properties',
  '/customers',
  '/staff',
  '/payments',
  '/wallet',
  '/giftcards',
  '/coupons',
  '/ads',
  '/disputes',
  '/messages',
  '/comms',
  '/audit',
  '/geo',
];

/**
 * Cells whose content is wider than the space the cell gives it.
 *
 * Measured against the cell's CONTENT box — its width minus its logical padding — because content
 * that fills the padding is already touching the border of the next column. One pixel of slack for
 * sub-pixel layout, so a rounding difference is not a failure.
 */
async function collisions(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found = new Set<string>();

    for (const cell of Array.from(document.querySelectorAll('td'))) {
      const box = cell.getBoundingClientRect();

      if (box.width === 0) continue;

      const style = getComputedStyle(cell);
      const inner =
        box.width -
        Number.parseFloat(style.paddingInlineStart) -
        Number.parseFloat(style.paddingInlineEnd);

      for (const child of Array.from(cell.children)) {
        const content = child.getBoundingClientRect().width;

        if (content > inner + 1) {
          const text = (cell.textContent ?? '').trim().slice(0, 30);

          found.add(
            `"${text}" needs ${Math.round(content)}px, has ${Math.round(inner)}px`,
          );
        }
      }
    }

    return Array.from(found);
  });
}

for (const width of [1024, 1280, 1440]) {
  test(`no table cell overlaps its neighbour at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });

    const broken: string[] = [];

    for (const path of SECTIONS) {
      await page.goto(`${path}?size=10`);

      for (const collision of await collisions(page)) {
        broken.push(`${path}: ${collision}`);
      }
    }

    expect(broken).toStrictEqual([]);
  });
}
