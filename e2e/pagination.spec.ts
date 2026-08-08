import { expect, test, type Page } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { DEFAULT_TABLE_PAGE_SIZE } from '../packages/contracts/src/table-preferences.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * Every table carries the pagination bar, and the operator picks the page and the size
 * (Bashar, 2026-08-05).
 *
 * ## Why this needs a browser
 *
 * The page and the size live in the URL, are read by a server component, clamped, passed to the
 * API, and have to survive a search submit, an arrow step and a size change. Nothing below the
 * browser exercises that chain, and the failure modes are all quiet: a table that reverts to 25
 * rows on page two, or an arrow that drops the filter, both look like they worked.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.use({ storageState: STAFF_STATE, viewport: { width: 1440, height: 900 } });

/** The staff registry's accessible name — see the note in `rowCount`. */
const STAFF_LIST_LABEL = 'حسابات الموظفين';

/**
 * Every section with a paginated table.
 *
 * Explicit rather than crawled, so adding a registry without pagination is a visible omission
 * here. `/geo` is deliberately absent — its three tables are bounded reference data and the one
 * documented exception, guarded instead by `geo-bounds.integration.test.ts`.
 */
const TABLES = [
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
  /* تحويلات الشركاء — a registry under الدفع, not a twentieth sidebar section. */
  '/payouts',
  /* التقييمات المُبلَّغ عنها — a card list, paged like every other registry. */
  '/reviews',
];

/**
 * Rows on the page, whichever shape the registry uses.
 *
 * Most are a `<table>`; the staff registry is a `<ul>` of cards, because each row carries a role
 * select and two actions. Both are paged lists, and the rule is about paged lists rather than about
 * the `<table>` element — so the count has to see both.
 */
async function rowCount(page: Page): Promise<number> {
  /*
    The labelled staff list is checked FIRST, before any `<table>`.

    The staff page renders BOTH: a `<ul>` of account cards, and the permission matrix, which is a
    real table with 216 rows. Preferring `tbody tr` therefore counted the matrix and reported 216
    rows for a page of five.
  */
  const staffList = page.getByRole('list', { name: STAFF_LIST_LABEL });

  if ((await staffList.count()) > 0) return staffList.locator('> li').count();

  return page.locator('tbody tr').count();
}

/**
 * The bar being asserted on.
 *
 * `/staff` is the one route with TWO: the accounts registry and the scope map, each under its own
 * URL parameters and its own landmark name. Everywhere else there is exactly one, so `.first()`
 * is the whole story — but on `/staff` an unscoped locator matches both and Playwright's strict
 * mode is right to refuse it.
 */
const bar = (page: Page, section?: string) =>
  page.getByRole('navigation', {
    name: section
      ? t.table.paginationLabelOf.replace('{section}', section)
      : t.table.paginationLabel,
  });

const anyBar = (page: Page) => page.getByRole('navigation', { name: /تنقّل بين/ });

const pageInput = (page: Page) => page.getByLabel(t.table.pageLabel).first();
const sizeSelect = (page: Page) => page.getByLabel(t.table.pageSizeLabel).first();
const nextArrow = (page: Page) =>
  page.getByRole('link', { name: t.table.nextPageShort }).first();
const previousArrow = (page: Page) =>
  page.getByRole('link', { name: t.table.previousPage }).first();

/** The staff registry's own bar, by name, so the scope map's does not answer for it. */
const staffBar = (page: Page) => bar(page, t.sections.staff.listLabel);

/*
  The size is saved against the ACCOUNT since 2026-08-06, so submitting the bar here MUTATES shared
  state that later specs and later runs read. Left alone, a run of this file made
  `navigation.spec.ts`'s "every table starts at ten rows" fail on the NEXT run, which is a failure
  with no relationship to the code that caused it. So the sections these tests submit are put back.
*/
test.afterAll(async ({ request }) => {
  for (const section of ['bookings', 'customers', 'partners']) {
    await request
      .post('/api/table-page-size', { form: { section, size: '10' } })
      .catch(() => null);
  }
});

/**
 * The total, in any of its Arabic forms.
 *
 * The bar used to read «{n} نتيجة» whatever the count was. It now agrees: 3–10 takes «نتائج», and
 * 11–99 takes the singular «نتيجة» again. A test pinned to one form asserts a grammar bug rather
 * than the presence of a total, and would fail the day the fixture count crossed a boundary.
 */
const RESULT_COUNT = /نتيجة|نتائج/;

test.describe('the pagination bar', () => {
  /**
   * Present on every paginated table, with every control.
   *
   * One test over all fourteen rather than fourteen tests, because the useful report is the LIST
   * of sections that are missing something — a per-section failure tells you about the first one
   * and stops.
   */
  test('appears under every table with all four controls', async ({ page }) => {
    const missing: string[] = [];

    for (const path of TABLES) {
      await page.goto(path);

      const bars = anyBar(page);

      if ((await bars.count()) === 0) {
        missing.push(`${path}: no pagination bar`);
        continue;
      }

      if ((await pageInput(page).count()) === 0) missing.push(`${path}: no page input`);
      if ((await sizeSelect(page).count()) === 0) missing.push(`${path}: no size select`);

      const value = await pageInput(page).inputValue();

      // The controls must show what is IN FORCE, not a placeholder — page one and the default size.
      if (value !== '1') missing.push(`${path}: page input shows "${value}", expected 1`);

      const size = await sizeSelect(page).inputValue();

      if (size !== String(DEFAULT_TABLE_PAGE_SIZE)) {
        missing.push(
          `${path}: size select shows "${size}", expected ${DEFAULT_TABLE_PAGE_SIZE}`,
        );
      }

      // The total is what the bar exists to report, and "0 نتيجة" on a full table is the bug.
      if ((await bars.first().getByText(RESULT_COUNT).count()) === 0)
        missing.push(`${path}: no total shown`);
    }

    expect(missing).toStrictEqual([]);
  });

  /**
   * The size changes how many rows come back.
   *
   * Asserted on a section with more rows than any size under test, so the count is decided by the
   * page size rather than by how much data happens to exist.
   */
  test('the size select changes the number of rows rendered', async ({ page }) => {
    await page.goto('/bookings?size=10');
    expect(await rowCount(page)).toBe(10);

    await page.goto('/bookings?size=50');
    expect(await rowCount(page)).toBe(50);
  });

  /** Choosing a size in the bar and applying it navigates and takes effect. */
  test('applies a size chosen in the select', async ({ page }) => {
    await page.goto('/bookings');

    await sizeSelect(page).selectOption('10');
    await page.getByRole('button', { name: t.table.apply }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get('size')).toBe('10');
    expect(await rowCount(page)).toBe(10);
  });

  /** Typing a page number and applying it jumps there. */
  test('jumps to a typed page number', async ({ page }) => {
    await page.goto('/bookings?size=5');

    const firstRow = await page.locator('tbody tr').first().innerText();

    await pageInput(page).fill('4');
    await page.getByRole('button', { name: t.table.apply }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('4');
    await expect(pageInput(page)).toHaveValue('4');

    // A different window, not the same rows re-rendered under a new number.
    expect(await page.locator('tbody tr').first().innerText()).not.toBe(firstRow);
  });

  /**
   * The chosen size survives a step.
   *
   * The failure this guards against is the quiet one: the arrow dropping `size` from its href, so
   * page one honours the choice and page two silently reverts to 25.
   */
  test('the size survives a step to the next page', async ({ page }) => {
    await page.goto('/bookings?size=5');
    expect(await rowCount(page)).toBe(5);

    await nextArrow(page).click();

    const url = new URL(page.url());

    expect(url.searchParams.get('size')).toBe('5');
    expect(url.searchParams.get('page')).toBe('2');
    expect(await rowCount(page)).toBe(5);
  });

  /** And a search keeps the size rather than resetting the table. */
  test('the size survives a search', async ({ page }) => {
    await page.goto('/bookings?size=5');

    await page.locator('input[name="q"]').fill('BKG');
    await page.getByRole('button', { name: new RegExp(`^${t.table.search}$`) }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get('size')).toBe('5');
  });

  /**
   * Stepping keeps the filter.
   *
   * Paging out of a filtered view is the bug the bar's hidden fields and href-building exist to
   * prevent: the reader thinks they are on page two of their search and is on page two of
   * everything, with no way to tell from the screen.
   */
  test('a step keeps the active filter', async ({ page }) => {
    await page.goto('/bookings?status=cancelled&size=5');

    test.skip(
      (await nextArrow(page).count()) === 0,
      'Not enough cancelled bookings seeded to page',
    );

    await nextArrow(page).click();

    const url = new URL(page.url());

    expect(url.searchParams.get('status')).toBe('cancelled');
    expect(url.searchParams.get('page')).toBe('2');
  });

  /** And so does typing a page number, which submits a form rather than following a link. */
  test('a typed page keeps the active filter', async ({ page }) => {
    await page.goto('/bookings?status=cancelled&size=5');

    await pageInput(page).fill('2');
    await page.getByRole('button', { name: t.table.apply }).click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get('status'))
      .toBe('cancelled');
  });

  /**
   * A hand-edited URL cannot break the page.
   *
   * The API rejects a limit over 100 and a page over 100,000 with a 400, so an unclamped
   * `?size=5000` would turn a typo into an error page instead of a table. `pageSize()` and
   * `pageNumber()` clamp before the request is made.
   */
  test('clamps out-of-range values instead of erroring', async ({ page }) => {
    await page.goto('/bookings?size=5000');

    await expect(page.locator('tbody tr').first()).toBeVisible();
    expect(await rowCount(page)).toBeLessThanOrEqual(100);

    await page.goto('/bookings?size=abc&page=abc');

    await expect(sizeSelect(page)).toHaveValue(String(DEFAULT_TABLE_PAGE_SIZE));
    await expect(pageInput(page)).toHaveValue('1');

    // Page zero and negative pages both mean page one, not a 400 and not an empty screen.
    await page.goto('/bookings?page=0');
    await expect(pageInput(page)).toHaveValue('1');
    await expect(page.locator('tbody tr').first()).toBeVisible();
  });
});

test.describe('the step arrows', () => {
  /**
   * Page one has no previous page, and the arrow says so by not being a link.
   *
   * A disabled-looking link that still navigates to `?page=0` is the failure here — the reason
   * `Step` renders a `<span>` rather than a styled `<a>`.
   */
  test('previous is not a link on page one', async ({ page }) => {
    await page.goto('/bookings');

    expect(await previousArrow(page).count()).toBe(0);
    await expect(nextArrow(page)).toBeVisible();
  });

  /** And it appears once there is somewhere to go back to. */
  test('previous appears on page two and returns to page one', async ({ page }) => {
    await page.goto('/bookings?size=5&page=2');

    await previousArrow(page).click();

    // Page one is spelt `page=1`, not an absent parameter — the bar builds an explicit URL.
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('1');
    expect(await previousArrow(page).count()).toBe(0);
  });

  /**
   * The last page offers no next.
   *
   * Read from the bar's own page count rather than assumed, so this holds whatever the database
   * happens to hold. The size is deliberately large, to make the walk short.
   */
  test('next is absent on the last page', async ({ page }) => {
    await page.goto('/customers?size=100');

    const pages = Number(
      (await bar(page)
        .innerText()
        .then((text) => text.match(/من\s+([\d,]+)/)?.[1]?.replace(/,/g, ''))) ?? '1',
    );

    await page.goto(`/customers?size=100&page=${pages}`);

    expect(await nextArrow(page).count()).toBe(0);
    await expect(previousArrow(page).or(pageInput(page)).first()).toBeVisible();
  });
});

test.describe('pagination itself', () => {
  /**
   * Every table either offers a next page or has fewer rows than the page size.
   *
   * Stated that way because a registry with three rows legitimately has no next page — asserting
   * an arrow is always present would only prove the dev database is large.
   */
  test('every table pages when there is more to show', async ({ page }) => {
    const broken: string[] = [];

    for (const path of TABLES) {
      await page.goto(`${path}?size=5`);

      const rows = await rowCount(page);
      const arrows = await nextArrow(page).count();

      if (rows === 5 && arrows === 0) {
        broken.push(`${path}: a full page of 5 rows and no next-page arrow`);
      }
    }

    expect(broken).toStrictEqual([]);
  });

  /**
   * A step forward shows different rows.
   *
   * The property that matters and the one a page-number scheme can plausibly get wrong: an
   * `OFFSET` computed from the wrong base returns the same window under a new number.
   */
  test('page two shows different rows from page one', async ({ page }) => {
    await page.goto('/customers?size=5');

    const first = await page.locator('tbody tr').allInnerTexts();

    await nextArrow(page).click();

    const second = await page.locator('tbody tr').allInnerTexts();

    expect(second).not.toStrictEqual(first);
    expect(second.filter((row) => first.includes(row))).toStrictEqual([]);
  });

  /**
   * The total does not change as the reader pages.
   *
   * "٢٥٣١ نتيجة" describes the SET, not the page. A total computed from the page — or a count
   * whose predicate has drifted from the list's — moves as you walk, which is how you find out
   * the two queries no longer describe the same rows.
   */
  test('the total is the same on page one and page two', async ({ page }) => {
    await page.goto('/customers?size=5');

    const onFirst = await bar(page).getByText(RESULT_COUNT).innerText();

    await nextArrow(page).click();

    expect(await bar(page).getByText(RESULT_COUNT).innerText()).toBe(onFirst);
  });

  /**
   * The total DESCRIBES the filter, and shrinks when the filter narrows.
   *
   * This is the invariant behind every service lifting its `FROM … WHERE` into one `fromWhere`
   * fragment shared by the list and the count. Written from a real failure: pointing the count at
   * the unfiltered table left a search that matches nothing reporting "٣٩٥٩ نتيجة" over an empty
   * table — a total that looks authoritative and describes a different set than the rows above it.
   *
   * A search nobody can match is the sharpest form of the check, because the only correct answer
   * is zero and any drift shows up as a number.
   */
  test('the total describes the filtered set, not the table', async ({ page }) => {
    await page.goto('/partners');

    const unfiltered = await bar(page).getByText(RESULT_COUNT).innerText();

    await page.goto('/partners?q=zzzzzznomatchzzzzzz');

    const filtered = await bar(page).getByText(RESULT_COUNT).innerText();

    expect(filtered).not.toBe(unfiltered);
    // Zero rows, and a total that says so.
    expect(await rowCount(page)).toBe(0);
    /*
      «لا نتائج», not «0 نتيجة». Arabic has a `zero` plural category and the catalogue uses it —
      a bar reading "0 نتيجة" is the literal translation of an English sentence, which is what the
      plural work replaced. Either shape is accepted so this asserts the TOTAL, not the wording.
    */
    expect(filtered).toMatch(/لا نتائج|(^|\D)0 /);
  });

  /**
   * A page past the end renders an empty table, not an error.
   *
   * The reader can TYPE a page number, so out of range is ordinary input. An empty table with the
   * total still shown says where they are; a 400 loses the screen.
   */
  test('a page past the end is empty rather than broken', async ({ page }) => {
    await page.goto('/customers?size=25&page=99999');

    await expect(
      page.getByRole('navigation', { name: t.table.paginationLabel }),
    ).toBeVisible();
    expect(await rowCount(page)).toBe(0);
    await expect(page.getByText(t.table.empty)).toBeVisible();
  });

  /**
   * The staff table is paged too.
   *
   * It returned every row until 2026-08-05 — 165 on the development database. Called out
   * separately because it was the exception, and because it is a `<ul>` rather than a `<table>`,
   * so it is the one registry the generic row count above has to special-case.
   */
  test('the staff table pages', async ({ page }) => {
    await page.goto('/staff?size=5');

    expect(await rowCount(page)).toBe(5);
    await expect(
      staffBar(page).getByRole('link', { name: t.table.nextPageShort }),
    ).toBeVisible();
  });

  /**
   * The two tables on `/staff` page independently.
   *
   * They share a route, so they cannot share `?page=`. Stepping the scope map while the accounts
   * registry stays on page two is the property that proves the namespacing works — and the failure
   * it guards against is the one that looks like data: both tables jumping at once.
   */
  test('the two tables on the staff route page independently', async ({ page }) => {
    await page.goto('/staff?size=5&page=2&scopeSize=10&scopePage=1');

    const scopeBar = bar(page, t.sections.staff.scopeTitle);

    await scopeBar.getByRole('link', { name: t.table.nextPageShort }).click();

    const params = new URL(page.url()).searchParams;

    expect(params.get('scopePage')).toBe('2');
    // The accounts table has not moved.
    expect(params.get('page')).toBe('2');
    await expect(staffBar(page).getByLabel(t.table.pageLabel)).toHaveValue('2');
    await expect(scopeBar.getByLabel(t.table.pageLabel)).toHaveValue('2');
  });
});
