import { expect, test, type Locator, type Page } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { DEFAULT_TABLE_PAGE_SIZE } from '../packages/contracts/src/table-preferences.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/** A size that is not the default, so these survive the default changing again. */
const NON_DEFAULT = DEFAULT_TABLE_PAGE_SIZE + 15;

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
    /*
      A NON-default size on purpose. The default became ten on 2026-08-06, and `returnQuery` drops
      a size that equals the default — a URL stating the default is noise. So `size=10` would have
      tested that the parameter is correctly absent, which is a different promise from this one.
    */
    /*
      A small size and page three, rather than page four at twenty-five. The promise under test is
      that page, size and filter all survive the round trip — it needs a page that EXISTS, not a
      large one, and demanding 76 cancelled bookings only coupled this test to how much data
      happened to be lying around.
    */
    const size = 2;
    const view = `/bookings?size=${size}&page=3&status=cancelled`;

    await page.goto(view);

    await page.locator('tbody tr a').first().click();
    await page.waitForURL(/\/bookings\/BKG/);

    // The detail URL carries the list state, which is how the back link can be built at all.
    const detail = new URL(page.url()).searchParams;

    expect(detail.get('page')).toBe('3');
    expect(detail.get('size')).toBe(String(size));
    expect(detail.get('status')).toBe('cancelled');

    await backTo(page, t.nav.bookings).click();
    await page.waitForURL(/\/bookings\?/);

    const returned = new URL(page.url());

    expect(returned.pathname).toBe('/bookings');
    expect(returned.searchParams.get('page')).toBe('3');
    expect(returned.searchParams.get('size')).toBe(String(size));
    expect(returned.searchParams.get('status')).toBe('cancelled');

    // And the reader is actually looking at that page, not just at a URL that says so.
    await expect(page.getByLabel(t.table.pageLabel).first()).toHaveValue('3');
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
    /*
      A size big enough that the last row is below the fold — ten fills less than one screen. It is
      also NON-default, which is why the returned URL keeps `?size=` below.
    */
    await page.goto(`/bookings?size=${NON_DEFAULT}`);

    const rows = page.locator('tbody tr');
    const last = rows.last();
    const anchor = await last.getAttribute('id');

    expect(anchor).toMatch(/^row-BKG/);

    // It starts below the fold — otherwise this test proves nothing.
    expect(await isInViewport(last)).toBe(false);

    await last.locator('a').first().click();
    await page.waitForURL(/\/bookings\/BKG/);

    /*
      Either shape: `returnQuery` carries a size that DIFFERS from the default and drops one that
      matches it, so whether there is a `?` depends on a number that has already changed once. The
      fragment is what identifies the destination, and it is asserted exactly on the next line.
    */
    await backTo(page, t.nav.bookings).click();
    await page.waitForURL(/\/bookings(\?|#)/);

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
   * Opening a linked record from a detail screen and coming back returns to THAT screen.
   *
   * Bashar's report (2026-08-06): from a booking, clicking the الشريك or العقار card and pressing
   * back landed on the partners or properties REGISTRY — a list the reader had never been in, with
   * their booking gone.
   */
  test('returns to the booking a partner was opened from', async ({ page }) => {
    const view = '/bookings?size=10&page=2';

    await page.goto(view);
    await page.locator('tbody tr a').first().click();
    await page.waitForURL(/\/bookings\/BKG/);

    const booking = new URL(page.url()).pathname;

    // The الشريك card.
    await page.getByText(t.sections.bookingDetail.partner, { exact: true }).click();
    await page.waitForURL(/\/partners\/PAR/);

    await backTo(page, t.table.backToOrigin['bookings']!).click();
    await page.waitForURL(/\/bookings\/BKG/);

    expect(new URL(page.url()).pathname).toBe(booking);

    /*
      And the trip COMPOSES: the booking still knows its list position, so one more press reaches
      page 2 of الحجوزات rather than the top. This is the half that a naive `from` would lose.
    */
    await backTo(page, t.nav.bookings).click();
    await page.waitForURL(/\/bookings(\?|#)/);

    const returned = new URL(page.url());

    expect(returned.pathname).toBe('/bookings');
    expect(returned.searchParams.get('page')).toBe('2');
  });

  /** The same for the العقار card, which is the other half of what Bashar screenshotted. */
  test('returns to the booking a property was opened from', async ({ page }) => {
    await page.goto('/bookings?size=10');
    await page.locator('tbody tr a').first().click();
    await page.waitForURL(/\/bookings\/BKG/);

    const booking = new URL(page.url()).pathname;

    await page.getByText(t.sections.bookingDetail.property, { exact: true }).click();
    await page.waitForURL(/\/properties\/PRO/);

    await backTo(page, t.table.backToOrigin['bookings']!).click();
    await page.waitForURL(/\/bookings\/BKG/);

    expect(new URL(page.url()).pathname).toBe(booking);
  });

  /**
   * A `?from=` this console did not issue is ignored, not followed.
   *
   * The unit tests cover the parsing exhaustively; this is the one that proves the parsing is
   * actually WIRED to the rendered link, which is the part a refactor can quietly sever.
   */
  test('never follows an origin from outside the console', async ({ page }) => {
    await page.goto('/bookings?size=5');

    const reference = (await page.locator('tbody tr a').first().innerText()).trim();

    for (const hostile of ['//evil.test', 'https://evil.test', 'dashboard:PAR-000002']) {
      await page.goto(`/bookings/${reference}?from=${encodeURIComponent(hostile)}`);

      const href = await backTo(page, t.nav.bookings).getAttribute('href');

      expect(href).toBe(`/bookings#row-${reference}`);
    }
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

  /**
   * The customer record, added 2026-08-26 when it grew a way in.
   *
   * A second registry through the same machinery, and worth its own case rather than trusting that
   * `returnQuery` behaves identically everywhere: العملاء builds its columns as a function of the
   * back query — a shape الحجوزات does not use — so the link is assembled in a different place and
   * could carry a different thing.
   *
   * The trip is asserted on the URL, and then on the FRAGMENT: `rowAnchor` writes both the row's
   * `id` and the `#…` the back link points at, and when those two drift the browser silently lands
   * at the top of the list, which is the bug.
   */
  test('returns to the same page of العملاء, and to the row', async ({ page }) => {
    const size = 2;

    await page.goto(`/customers?size=${size}&page=3`);

    const link = page.locator('tbody a[href^="/customers/CUS-"]').first();
    const reference =
      /CUS-[\w-]+/.exec((await link.getAttribute('href')) ?? '')?.[0] ?? '';

    expect(reference, 'a customer on page three').not.toBe('');

    await link.click();
    await page.waitForURL(/\/customers\/CUS-/);

    const detail = new URL(page.url()).searchParams;

    expect(detail.get('page')).toBe('3');
    expect(detail.get('size')).toBe(String(size));

    await backTo(page, t.nav.customers).click();
    await page.waitForURL(/\/customers\?/);

    const returned = new URL(page.url());

    expect(returned.pathname).toBe('/customers');
    expect(returned.searchParams.get('page')).toBe('3');
    expect(returned.searchParams.get('size')).toBe(String(size));
    /* The row it was opened from, so the reader lands on it rather than at the top. */
    expect(returned.hash).toBe(`#row-${reference}`);
    await expect(page.locator(`#row-${reference}`)).toHaveCount(1);
  });
});
