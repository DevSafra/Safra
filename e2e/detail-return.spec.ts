import { expect, test, type Locator, type Page } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * A detail screen returns to the exact list view it was opened from.
 *
 * Bashar's report (2026-08-05): the back control said «القوائم», linked to the DASHBOARD, and was
 * unstyled text. Someone on page 4 of a filtered الحجوزات search opened a booking and could not get
 * back to their search — a registry of 4,300 bookings makes that an expensive click.
 *
 * ## Why a browser
 *
 * The chain is: the list renders a row link carrying its own page, size and filters; the detail
 * screen reads them back off its own URL and rebuilds the list href. Every link in that chain is
 * server-rendered, and the failure mode is silent — a back link to `/bookings` looks fine and
 * quietly loses the reader's place.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.use({ storageState: STAFF_STATE, viewport: { width: 1440, height: 900 } });

/** An element's painted background, for telling the returned-to row apart from its neighbours. */
async function background(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).backgroundColor);
}

/**
 * Whether an element is inside the visible window, which is the only thing "scrolled to it" means.
 *
 * Asserted on the painted rectangle rather than on `window.scrollY`, because a scroll offset says
 * the page moved, not that it moved to the right place.
 */
async function isInViewport(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const box = el.getBoundingClientRect();

    return box.top >= 0 && box.bottom <= window.innerHeight;
  });
}

/**
 * The back control, by the section it announces.
 *
 * Matched on the ACCESSIBLE name, not the visible «رجوع». The visible word is the same on all four
 * detail screens, so a visible-text match would find «رجوع» on the wrong screen and pass; the
 * accessible name is the only thing that still distinguishes them — and asserting on it is also
 * what keeps the `aria-label` from being dropped as redundant.
 */
const backTo = (page: Page, section: string) =>
  page.getByRole('link', { name: t.table.backToLabel.replace('{section}', section) });

test.describe('the back control', () => {
  /**
   * The whole round trip, on the registry Bashar reported.
   *
   * Asserted on the URL rather than on the rows, because the URL is what carries the state and a
   * row assertion would also pass if both pages happened to show the same booking.
   */
  test('returns to the same page, size and filter', async ({ page }) => {
    const view = '/bookings?size=10&page=4&status=cancelled';

    await page.goto(view);

    await page.locator('tbody tr a').first().click();
    await page.waitForURL(/\/bookings\/BKG/);

    // The detail URL carries the list state, which is how the back link can be built at all.
    const detail = new URL(page.url()).searchParams;

    expect(detail.get('page')).toBe('4');
    expect(detail.get('size')).toBe('10');
    expect(detail.get('status')).toBe('cancelled');

    await backTo(page, t.nav.bookings).click();
    await page.waitForURL(/\/bookings\?/);

    const returned = new URL(page.url());

    expect(returned.pathname).toBe('/bookings');
    expect(returned.searchParams.get('page')).toBe('4');
    expect(returned.searchParams.get('size')).toBe('10');
    expect(returned.searchParams.get('status')).toBe('cancelled');

    // And the reader is actually looking at that page, not just at a URL that says so.
    await expect(page.getByLabel(t.table.pageLabel).first()).toHaveValue('4');
  });

  /** A search survives the trip too, not only the paging. */
  test('returns to the same search', async ({ page }) => {
    await page.goto('/bookings?q=BKG&size=10');

    await page.locator('tbody tr a').first().click();
    await page.waitForURL(/\/bookings\/BKG/);

    await backTo(page, t.nav.bookings).click();
    await page.waitForURL(/\/bookings\?/);

    expect(new URL(page.url()).searchParams.get('q')).toBe('BKG');
  });

  /**
   * Reached WITHOUT a list — a bookmark, the dashboard, the reference lookup — still goes somewhere
   * sensible.
   *
   * The plain registry, not a 404 and not the dashboard: the reader was never in a list, so there
   * is no position to restore, and the section they are looking at is the useful destination.
   *
   * The row FRAGMENT is still there, and that is deliberate. It comes from the record the screen is
   * already displaying rather than from the URL, so it costs nothing to keep: if the row happens to
   * be on the registry's first page the reader lands on it, and if it is not, nothing matches and
   * they land at the top — which is the fallback either way. So this asserts there is no restored
   * QUERY, which is the thing that would be wrong.
   */
  test('falls back to the plain registry when there is no position', async ({ page }) => {
    await page.goto('/bookings?size=5');

    const reference = await page.locator('tbody tr a').first().innerText();

    await page.goto(`/bookings/${reference.trim()}`);

    const href = await backTo(page, t.nav.bookings).getAttribute('href');

    expect(href).toBe(`/bookings#row-${reference.trim()}`);
    expect(href).not.toContain('?');
  });

  /**
   * Present, named and styled as a control on every detail screen.
   *
   * The styling is asserted because "looks like a stray caption" was half of the report: a border
   * is the difference between a control and a caption, and it is the property that regressed.
   */
  test('every detail screen has one, and it looks like a control', async ({ page }) => {
    const screens: [string, string][] = [
      ['/bookings', t.nav.bookings],
      ['/partners', t.nav.partners],
      ['/properties', t.nav.properties],
    ];

    const broken: string[] = [];

    for (const [list, section] of screens) {
      await page.goto(`${list}?size=5`);
      await page.locator('tbody tr a').first().click();
      await page.waitForURL(new RegExp(`${list}/.+`));

      const control = backTo(page, section);

      if ((await control.count()) === 0) {
        broken.push(`${list}: no back control naming ${section}`);
        continue;
      }

      const border = await control.evaluate(
        (el) => getComputedStyle(el).borderBottomWidth,
      );

      if (border === '0px') broken.push(`${list}: the back control has no border`);
    }

    expect(broken).toStrictEqual([]);
  });

  /**
   * Coming back lands on the ROW, not at the top of the page.
   *
   * Bashar asked for it (2026-08-05): returning to the right page of the right filter still left
   * the reader hunting, because 25 rows is a screen and a half and the row they opened is often
   * below the fold. The back link carries `#row-<reference>` and every row carries the matching
   * id.
   *
   * The last row of a full page is the case worth testing — the first row is above the fold
   * whether or not anything works, so a test written against it passes on a broken build.
   */
  test('scrolls back to the row that was opened', async ({ page }) => {
    await page.goto('/bookings?size=25');

    const rows = page.locator('tbody tr');
    const last = rows.last();
    const anchor = await last.getAttribute('id');

    expect(anchor).toMatch(/^row-BKG/);

    // It starts below the fold — otherwise this test proves nothing.
    expect(await isInViewport(last)).toBe(false);

    await last.locator('a').first().click();
    await page.waitForURL(/\/bookings\/BKG/);

    /*
      No `?` to wait for: `size=25` IS the default, so `returnQuery` drops it rather than writing a
      URL that states the default. The fragment is what identifies the destination here.
    */
    await backTo(page, t.nav.bookings).click();
    await page.waitForURL(/\/bookings#/);

    expect(new URL(page.url()).hash).toBe(`#${anchor}`);

    // By attribute rather than `#id`, so the selector holds whatever a reference format turns into.
    const returned = page.locator(`[id="${anchor}"]`);

    await expect(returned).toBeVisible();
    expect(await isInViewport(returned)).toBe(true);

    /*
      And it is MARKED. Scrolling somewhere without tinting anything leaves the reader to guess
      which of the visible rows is theirs — the row landed at the bottom of the window here, not
      under the cursor. Asserted as "different from an ordinary row" rather than as a fixed colour,
      so the check survives a theme change but not the tint being dropped.
    */
    const [target, ordinary] = await Promise.all([
      background(returned),
      background(rows.first()),
    ]);

    expect(target).not.toBe(ordinary);
  });

  /**
   * The arrow sits on the RIGHT of «رجوع», which is the leading edge of an RTL control.
   *
   * Bashar reported it on the left (2026-08-05). The cause was that «→» is bidi-NEUTRAL, so
   * `'→ رجوع'` as one string let the bidi algorithm decide the side; it is now its own flex item,
   * and `flex-direction: row` under `dir="rtl"` puts the first item on the right unconditionally.
   *
   * Geometry rather than DOM order, because DOM order is exactly what was already right while the
   * rendering was wrong — only the painted position can tell the two apart.
   */
  test('points back with the arrow on the right of the label', async ({ page }) => {
    await page.goto('/bookings?size=5');
    await page.locator('tbody tr a').first().click();
    await page.waitForURL(/\/bookings\/BKG/);

    const control = backTo(page, t.nav.bookings);
    const arrow = control.locator('[aria-hidden="true"]');
    const label = control.getByText(t.table.back, { exact: true });

    await expect(arrow).toHaveText(t.table.backArrow);

    const [arrowBox, labelBox] = await Promise.all([
      arrow.boundingBox(),
      label.boundingBox(),
    ]);

    expect(arrowBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(arrowBox!.x).toBeGreaterThan(labelBox!.x);
  });
});
