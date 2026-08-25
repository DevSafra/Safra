import { expect, test, type Page } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import {
  DEFAULT_TABLE_PAGE_SIZE,
  TABLE_SECTION_PARAMS,
} from '../packages/contracts/src/table-preferences.js';
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
 * Most are a `<table>`; the staff registry is a `<ul>` of cards, each one a link to that person's
 * record. Both are paged lists, and the rule is about paged lists rather than about the `<table>`
 * element — so the count has to see both.
 */
async function rowCount(page: Page): Promise<number> {
  /*
    The labelled staff list is checked FIRST, before any `<table>`.

    It was load-bearing when الموظفون also rendered the permission matrix — a real table with 216
    rows, so preferring `tbody tr` counted the matrix and reported 216 rows for a page of five. The
    matrix moved to أدوار الموظفين on 2026-08-23, but the ORDER stays: the staff list is a `<ul>`
    either way, and a `tbody tr` fallback that happens to be correct today is not a reason to make
    the labelled list second.
  */
  const staffList = page.getByRole('list', { name: STAFF_LIST_LABEL });

  if ((await staffList.count()) > 0) return staffList.locator('> li').count();

  return page.locator('tbody tr').count();
}

/**
 * The bar being asserted on.
 *
 * Every route now has exactly one, so `.first()` is the whole story. `/staff` had TWO until
 * 2026-08-23 — the accounts registry and the scope map — and the scope map moved to the member's
 * own record, which is not a paged list. The named lookup is kept rather than simplified away: a
 * second table returning to any of these screens would otherwise make an unscoped locator match
 * both, and Playwright's strict mode would fail somewhere unrelated to the change that caused it.
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
/*
  The arrows became `<Link scroll={false}>` on 2026-08-24 so paging stops throwing the reader to the
  top of the page. That makes the step a SOFT navigation: React updates the URL and the rows after
  the click resolves, so reading `page.url()` or the rows on the next line races the render and sees
  the page you just left. Every assertion that follows an arrow now polls.

  It is a change in the test, not in what is being tested — the neighbouring search assertions have
  polled since they were written, for the same reason.
*/
const nextArrow = (page: Page) =>
  page.getByRole('link', { name: t.table.nextPageShort }).first();
const previousArrow = (page: Page) =>
  page.getByRole('link', { name: t.table.previousPage }).first();

/** The staff registry's own bar, by name — see the note above on why this stays explicit. */
const staffBar = (page: Page) => bar(page, t.sections.staff.listLabel);

/*
  The size is saved against the ACCOUNT since 2026-08-06, so submitting the bar here MUTATES shared
  state that later specs and later runs read. Left alone, a run of this file made
  `navigation.spec.ts`'s "every table starts at ten rows" fail on the NEXT run, which is a failure
  with no relationship to the code that caused it. So the sections these tests submit are put back.
*/
test.afterAll(async ({ request }) => {
  const submitted = [
    'bookings',
    'customers',
    'partners',
    'staff',
    'staffActivity',
  ] as const;

  for (const section of submitted) {
    /*
      The section's OWN size parameter, not the literal `size`.

      A namespaced table posts `activitySize`/`queueSize`/`vsize`, and since 2026-08-25 the endpoint
      reads the name belonging to the section — correctly, because that is what the bar sends. So a
      put-back hard-coding `size` is silently ignored for exactly the namespaced sections, and this
      cleanup reported success while leaving 25 rows saved for the next run. It did precisely that on
      the run that first added `staffActivity` to this list.
    */
    const { size } = TABLE_SECTION_PARAMS[section];

    await request
      .post('/api/table-page-size', {
        form: { section, [size]: String(DEFAULT_TABLE_PAGE_SIZE) },
      })
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
/**
 * The result count, in every Arabic plural form the catalogue can produce.
 *
 * `/نتيجة|نتائج/` was not enough, and the gap took a registry holding exactly TWO rows to expose:
 * Arabic has a DUAL, so `t.table.found` renders «نتيجتان» at n=2 — spelled with a ت where the
 * singular has a ة, matching neither alternative. Every registry was empty or larger, so the bar
 * looked untotalled the first time one had two rows in it (بطاقات الهدايا, 2026-08-11).
 *
 * `نتيج` covers the singular, the dual and both capped duals; `نتائج` is the separate broken plural.
 */
const RESULT_COUNT = /نتيج|نتائج/;

/**
 * The total, by MARKER rather than by matching its words.
 *
 * `RESULT_COUNT` above still describes the wording, and is still used to prove the total READS as a
 * count in one of Arabic's forms. But addressing the element by its text made every neighbouring
 * sentence a candidate: the single-page note added on 2026-08-25 contained «النتائج» and two elements
 * then answered to one locator. `data-table-total` is on exactly one span per bar.
 */
const total = (page: Page, section?: string) =>
  bar(page, section).locator('[data-table-total]');

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
      const totals = bars.first().locator('[data-table-total]');

      if ((await totals.count()) === 0) {
        missing.push(`${path}: no total shown`);
      } else if (!RESULT_COUNT.test(await totals.innerText())) {
        /*
          Found by MARKER, then checked for WORDING — both, and neither is enough alone. The marker
          alone would pass on a span rendering a bare number; the wording alone matched any
          neighbouring sentence that mentioned results, which is how the single-page note added on
          2026-08-25 broke this assertion by existing.
        */
        missing.push(`${path}: total reads "${await totals.innerText()}", not a count`);
      }
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

    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
    expect(new URL(page.url()).searchParams.get('size')).toBe('5');
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

    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
    expect(new URL(page.url()).searchParams.get('status')).toBe('cancelled');
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
   * The EC-008 filter behaves like every other one — and can be turned off.
   *
   * It arrives from the dashboard's most urgent alert, which until 2026-08-13 had a dimmed button on
   * the stale grounds that no browsable booking list existed. Two things have to hold for that link
   * to be worth following: the filter survives a search (or typing a query silently widens the view
   * back to every booking), and it has an OFF switch (or an operator who followed the alert is stuck
   * on a table they cannot explain).
   */
  test('the expiring filter survives a search and can be cleared', async ({ page }) => {
    await page.goto('/bookings?expiring=1&size=5');

    /*
      By ROLE and name, not by `input[name="expiring"]`.

      That selector matches two elements, and both are correct: the toolbar's checkbox, and a hidden
      field inside the pagination bar's own form — which is exactly how the filter survives a typed
      page number. The visible control is the one this test drives.
    */
    const toggle = page.getByRole('checkbox', {
      name: t.sections.bookings.expiringOnly,
    });

    await expect(toggle).toBeChecked();

    /* A search keeps it: the checkbox is inside the toolbar's form. */
    await page.locator('input[name="q"]').fill('BKG');
    await page.getByRole('button', { name: new RegExp(`^${t.table.search}$`) }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get('expiring')).toBe('1');

    /* And unchecking it leaves the filtered view rather than trapping the reader in it. */
    await toggle.uncheck();
    await page.getByRole('button', { name: new RegExp(`^${t.table.search}$`) }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get('expiring')).toBeNull();
  });

  /**
   * A NAMESPACED bar submits, and does not answer a JSON document.
   *
   * ## Why this is separate from every other submit test above
   *
   * All of them drive `/bookings`, whose bar posts `page` and `size` — the plain names. Five of the
   * console's tables namespace theirs, because they share a route with a registry that already owns
   * `?page=`: آخر نشاط الموظفين posts `activityPage`/`activitySize`, the two verification queues post
   * `queuePage`/`queueSize`, a partner's violations posts `vpage`/`vsize`.
   *
   * The save endpoint read the LITERAL `size`, so for all five it saw nothing, failed validation and
   * answered `{"message":"Unknown table or size."}` — which the browser rendered as a bare document,
   * because the bar is a plain HTML form and a form submit is a navigation. Bashar met it on a table
   * with two rows in it, 2026-08-25, by both controls: page number and size, since they share a form.
   *
   * **250 browser tests passed over it.** Not because the assertions were weak, but because every one
   * of them picked the easy table — the same shape as `detail-return.spec.ts` having to be written
   * against the LAST row of a full page, for the same reason. So this test drives the bar the defect
   * was actually in.
   *
   * `/staff` is the case in point: the registry's bar and the activity panel's bar are on ONE screen,
   * so this also proves that submitting one does not move the other.
   */
  test('a namespaced bar applies without a JSON screen, and leaves its neighbour alone', async ({
    page,
  }) => {
    await page.goto('/staff?page=2&size=10');

    const activityBar = bar(page, t.sections.staff.activity);

    await expect(activityBar).toBeVisible();

    /* The panel's OWN select and button, scoped to its bar — the screen has two of each. */
    await activityBar.getByLabel(t.table.pageSizeLabel).selectOption('25');
    await activityBar.getByRole('button', { name: t.table.apply }).click();

    /*
      The assertion that would have caught the defect. A JSON body replaces the document, so the
      console's own landmarks go with it: no `<nav>`, no shell, nothing but text. Checked before the
      URL, because a JSON screen has a URL too and it is this route's.
    */
    await expect(anyBar(page).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Unknown table or size');

    const url = new URL(page.url());

    expect(url.pathname).toBe('/staff');
    expect(url.searchParams.get('activitySize')).toBe('25');

    /*
      And the registry it shares the screen with has not moved. Sharing `?page=` is the failure the
      namespacing exists to prevent, and a fix that read the right field but wrote the wrong one
      would pass every assertion above.
    */
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('size')).toBe('10');
  });

  /**
   * The registry's own bar on the same screen, for the opposite direction.
   *
   * Without this, a route that ignored the section entirely and always wrote `activitySize` would
   * satisfy the test above. The pair is what proves the two bars are actually independent.
   */
  test('the registry bar on a two-table screen moves only itself', async ({ page }) => {
    await page.goto('/staff?activityPage=2&activitySize=25');

    await staffBar(page).getByLabel(t.table.pageSizeLabel).selectOption('25');
    await staffBar(page).getByRole('button', { name: t.table.apply }).click();

    await expect(anyBar(page).first()).toBeVisible();

    const url = new URL(page.url());

    expect(url.searchParams.get('size')).toBe('25');
    expect(url.searchParams.get('activityPage')).toBe('2');
    expect(url.searchParams.get('activitySize')).toBe('25');
  });

  /**
   * A table that fits on one page offers nothing to press (Bashar, 2026-08-25).
   *
   * He met this on a registry holding two rows: both arrows correctly greyed, and beside them a page
   * box still inviting a number and a تطبيق still inviting a press. Typing 2 and pressing it is what
   * produced the JSON screen — and with that fixed, a live control that cannot move anything is
   * still a promise the screen cannot keep.
   *
   * ## Driven by making a table one page, not by finding one
   *
   * `?size=100` puts every registry on a single page whatever the fixtures hold, so this does not
   * depend on some section happening to be small today — which is exactly how the two-row case
   * stayed unnoticed. The size select's own condition is different and is asserted separately below.
   */
  test('disables the paging controls when everything is on one page', async ({
    page,
  }) => {
    await page.goto('/giftcards?size=100');

    /* Precondition, asserted rather than assumed: this really is one page. */
    await expect(bar(page)).toContainText(t.table.singlePage);

    await expect(pageInput(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: t.table.apply })).toBeDisabled();
    /* The arrows were already dead; they are `<span aria-disabled>`, not links. */
    await expect(page.getByRole('link', { name: t.table.nextPageShort })).toHaveCount(0);
  });

  /**
   * And the size select stays live while it can still do something.
   *
   * The opposite control, and the reason `sizeIsMoot` is not simply `pages <= 1`: a 25-row table
   * shown at 100 rows is ALSO one page, and there the select is the only way back to something
   * scannable. A fix that disabled every control on any single-page table would take that away, pass
   * the test above, and be a worse screen than the one it replaced.
   *
   * ## The fixture is FOUND, not assumed
   *
   * This needs a table holding between eleven and a hundred rows, and which table that is depends on
   * the development database. A hard-coded path with a `test.skip` guessing at its size is how the
   * first draft of this test passed while asserting nothing — it picked a filtered set that turned
   * out to have more than one page, and the guard did not catch it because a FULL page of 100 rows
   * looks the same as the first page of many. So the table is located by reading the bar.
   */
  test('keeps the size select usable on one page when it can still narrow the view', async ({
    page,
  }) => {
    let found = '';

    for (const path of TABLES) {
      await page.goto(`${path}?size=100`);

      /* One page — the note says so — and more than the smallest size, so the select still matters. */
      const single = (await bar(page).getByText(t.table.singlePage).count()) > 0;

      if (single && (await rowCount(page)) > 10) {
        found = path;
        break;
      }
    }

    test.skip(
      found === '',
      'No registry currently holds between eleven and a hundred rows',
    );

    await expect(pageInput(page)).toBeDisabled();
    await expect(sizeSelect(page)).toBeEnabled();
    await expect(page.getByRole('button', { name: t.table.apply })).toBeEnabled();

    /* And it really works: the reader comes back down to a scannable page. */
    await sizeSelect(page).selectOption('10');
    await page.getByRole('button', { name: t.table.apply }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get('size')).toBe('10');
    expect(await rowCount(page)).toBe(10);
  });

  /**
   * Deleting the `disabled` attribute and pressing تطبيق does NOTHING (Bashar, 2026-08-25).
   *
   * His question, and the right one to ask: "if I changed the html + style in dev tools of the
   * button and fields and then removed the disabled tag from it and click on it, I should get
   * nothing and nothing should happen."
   *
   * It did not. It redirected to `?page=2` of a one-page table, and the reader met an EMPTY table
   * under a total that still read «نتيجة واحدة» — the worst of the three possible answers, because
   * a table with no rows beneath a count of one looks like the rows went missing rather than like
   * the request was ignored.
   *
   * ## Why this is a test and not a note about client-side guards
   *
   * A `disabled` attribute is a courtesy. The endpoint is the control, and the only way to know what
   * the endpoint does when the courtesy is gone is to take it away and press the button — which is
   * exactly what this does, in the DOM, the way a person would.
   */
  test('a tampered submit on a one-page table changes nothing', async ({ page }) => {
    await page.goto('/reviews');

    const bar = anyBar(page).first();

    /* Precondition: this really is the state where the controls are dead. */
    await expect(bar).toContainText(t.table.singlePage);
    await expect(pageInput(page)).toBeDisabled();

    const before = {
      url: page.url(),
      rows: await rowCount(page),
      total: await bar.locator('[data-table-total]').innerText(),
    };

    /*
      What a person does in DevTools: strip the attribute off all three controls.

      Typed as `Element` rather than left to inference — `querySelectorAll` inside `evaluate` widens
      to `any` under this eslint config, and an `any` in a test is how an assertion stops asserting.
    */
    await bar.evaluate((nav: Element) => {
      for (const control of Array.from(nav.querySelectorAll('input, select, button'))) {
        control.removeAttribute('disabled');
      }
    });

    await expect(pageInput(page)).toBeEnabled();

    /* And ask for a page that does not exist. */
    await pageInput(page).fill('2');
    await page.getByRole('button', { name: t.table.apply }).click();

    /* Never a body: the console is still here. */
    await expect(anyBar(page).first()).toBeVisible();

    /*
      Nothing happened. Specifically: no `page=2` in the URL, the same rows, the same total — and
      still the same one-page state, so the reader is not left looking at an empty table.
    */
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBeNull();

    expect(await rowCount(page)).toBe(before.rows);
    expect(await anyBar(page).first().locator('[data-table-total]').innerText()).toBe(
      before.total,
    );
    await expect(anyBar(page).first()).toContainText(t.table.singlePage);
  });

  /**
   * The opposite control: the ceiling narrows nothing on a table that HAS the pages.
   *
   * Every assertion above would also pass on an endpoint that had simply stopped honouring page
   * numbers altogether — which would break the box on every large registry and is a far worse bug
   * than the one being fixed. So a real multi-page table must still jump.
   */
  test('the page ceiling does not interfere with a table that has the pages', async ({
    page,
  }) => {
    await page.goto('/bookings?size=10');

    await pageInput(page).fill('3');
    await page.getByRole('button', { name: t.table.apply }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('3');
    await expect(pageInput(page)).toHaveValue('3');
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

    const text = await bar(page).innerText();

    /*
      Past `COUNT_CAP` the page count is a FLOOR, not a total — so "the last page" is not what the
      bar says (2026-08-23).

      The count is capped at 10,000 deliberately, so an ever-growing table costs a bounded query;
      past it the bar prints «أكثر من ١٠٠٠٠ نتيجة» rather than an exact figure, and the page count
      it derives caps with it. The dev database crossed the cap at 10,198 customers, so this walked
      to page 100 of a 102-page list, found a next arrow, and reported a bug that was the product
      working exactly as `.claude/CLAUDE.md` specifies.

      Skipped rather than adapted: with a capped total there is no way to ADDRESS the last page,
      which is the premise this test needs. Asserting something weaker in that state would keep it
      green while checking nothing, which is the failure mode this suite hit three times today.
    */
    const capped = text.includes('أكثر من');

    test.skip(
      capped,
      'The customer count is past COUNT_CAP, so the bar reports a floor and the last page is not addressable.',
    );

    const pages = Number(text.match(/من\s+([\d,]+)/)?.[1]?.replace(/,/g, '') ?? '1');

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
    /* Wait for the SOFT navigation to land before reading rows — see the note above. */
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');

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

    const onFirst = await total(page).innerText();

    await nextArrow(page).click();

    expect(await total(page).innerText()).toBe(onFirst);
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

    const unfiltered = await total(page).innerText();

    await page.goto('/partners?q=zzzzzznomatchzzzzzz');

    const filtered = await total(page).innerText();

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

  /*
    REMOVED 2026-08-23: "the two tables on the staff route page independently".

    It drove the scope map's bar to prove that a second table on one route does not share `?page=`
    with the first. نطاق العمل moved to the member's own record, where it is a line rather than a
    paged list, so `/staff` has one table and the test had no second bar to click.

    The invariant it protected is NOT dropped — `table-preferences.test.ts` still asserts that
    `staffScope` shares `/staff`'s path and does NOT share its parameters. That is the map-level
    version of the same rule, it needs no rendered table, and it is where the namespacing is
    actually decided. Restore a browser test here the day a route grows a second paged list.
  */
});
