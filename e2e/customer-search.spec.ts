import { expect, test } from '@playwright/test';

/**
 * The results page — paging, filtering, and what its own links are allowed to carry.
 *
 * Every assertion here corresponds to something the page could not do, or did wrongly, on
 * 2026-09-02. None of them would have failed any unit test: the page rendered, returned 200 and
 * looked finished.
 */
test.use({ baseURL: 'http://localhost:3000' });

/** A night the §5.3 cutoff cannot close, so the suite does not change behaviour at 17:00. */
const STAY = 'checkIn=2026-09-03&checkOut=2026-09-04&adults=2';
const SEARCH = `/ar/search?${STAY}`;

const apply = 'button[type="submit"]:has-text("طبّق")';

/**
 * Result 25 was unreachable.
 *
 * Not "hard to reach" — unreachable. The page asked for 24 and rendered them, sent no cursor, and
 * `limit` caps at 60, so no URL a person could type would show the twenty-fifth stay. §2 makes
 * pagination mandatory on every list a customer reads.
 */
test('the results can be paged past the first screenful', async ({ page }) => {
  /*
    Compared by LINK, never by name. `db:testbed` gives twenty-four published stays that share one
    name, so an assertion on the heading text reports two identical pages for two completely
    different result sets — it fails against a working build and would pass against a broken one
    the day the fixture names differ. The slug is what identifies a result.
  */
  const slugs = () =>
    page
      .locator('article a[href*="/property/"]')
      .evaluateAll((links) =>
        links.map((link) => (link.getAttribute('href') ?? '').split('?')[0]),
      );

  await page.goto(SEARCH);

  const first = await slugs();

  expect(first.length).toBeGreaterThan(0);

  const next = page.locator('a[rel="next"]');

  await expect(next).toBeVisible();
  await next.click();
  await page.waitForURL(/cursor=/);

  const second = await slugs();

  expect(second.length).toBeGreaterThan(0);
  /*
    Nothing in common — which is what distinguishes real paging from a cursor that was accepted and
    ignored. The latter renders a second page identical to the first and looks like working paging
    in a screenshot.
  */
  expect(second.filter((slug) => first.includes(slug))).toStrictEqual([]);

  /*
    And back, which needs the cursor the API computes — the page cannot build one itself.

    «السابق» from page two carries the cursor for OFFSET ZERO, not no cursor at all: the first page
    has two valid addresses, its bare URL and `?cursor=MA`. That is deliberate rather than untidy —
    the alternative is the customer app decoding the cursor to recognise the start, which would be
    a second definition of a wire format the API owns. The page is `noindex`, so two addresses for
    one page cost nothing. What matters is that the RESULTS are the first page's again.
  */
  await page.locator('a[rel="prev"]').click();
  await page.waitForLoadState('networkidle');
  expect(await slugs()).toStrictEqual(first);
});

/**
 * Filtering, driven through the panel rather than by typing a URL.
 *
 * `searchQuerySchema` accepted a price range, a property type, attributes, amenity codes and a
 * free-cancellation switch since it was written, and the screen offered a sort order. The panel is
 * the only thing that makes any of it reachable.
 */
test('a filter applies, survives in the URL, and keeps the search', async ({ page }) => {
  await page.goto(SEARCH);

  await page.locator('input[name="minPrice"]').fill('60');
  await page.locator('input[name="freeCancellationOnly"]').check();
  await page.locator(apply).click();
  await page.waitForURL(/minPrice=60/);

  /* The dates and the party are not filters and must not be lost by filtering. */
  expect(page.url()).toContain('checkIn=2026-09-03');
  expect(page.url()).toContain('adults=2');
  expect(page.url()).toContain('freeCancellationOnly=true');

  /* The panel comes back holding what was chosen, or the next change silently resets it. */
  await expect(page.locator('input[name="minPrice"]')).toHaveValue('60');
  await expect(page.locator('input[name="freeCancellationOnly"]')).toBeChecked();

  /* Clearing drops the filters and keeps the search. */
  await page.getByRole('link', { name: 'مسح الكل' }).click();
  await page.waitForURL((url) => !url.searchParams.has('minPrice'));
  expect(page.url()).toContain('checkIn=2026-09-03');
  expect(page.url()).not.toContain('freeCancellationOnly');
});

/**
 * The page's own links carry only what the page understands.
 *
 * They were built by iterating `Object.entries` over the request's query string, which put
 * arbitrary caller-chosen parameters into four links on our own page. Not an injection —
 * `URLSearchParams` encodes and the base path is a literal — but it is the shape `returnQuery` was
 * written to forbid, and the allow-list is the fix.
 *
 * Scoped to the RESULTS, deliberately. The footer's language picker carries the whole query string
 * on purpose, so that changing language keeps the reader on their search; asserting over every
 * anchor on the page would fail on behaviour that is correct.
 */
test('a crafted parameter is dropped rather than reflected into the results links', async ({
  page,
}) => {
  await page.goto(`${SEARCH}&surprise=xyz123&attributes=notarealattribute`);

  const hrefs = await page
    .locator('main a, [aria-label] a[rel]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));

  expect(hrefs.length).toBeGreaterThan(0);
  expect(hrefs.filter((href) => href.includes('surprise'))).toStrictEqual([]);
  expect(hrefs.filter((href) => href.includes('notarealattribute'))).toStrictEqual([]);

  /* An unknown attribute must not survive into the form's state either. */
  await expect(page.locator('input[name="attributes"]:checked')).toHaveCount(0);

  /* And the page still answers with results rather than a validation error. */
  await expect(page.locator('article').first()).toBeVisible();
});

/**
 * Sorting returns to the first page.
 *
 * Keeping an offset across a reorder lands the reader on page three of a differently ordered list,
 * which shows them stays they have never seen while the URL claims they are where they were.
 */
test('changing the sort order returns to the first page', async ({ page }) => {
  await page.goto(SEARCH);
  await page.locator('a[rel="next"]').click();
  await page.waitForURL(/cursor=/);

  await page.getByRole('link', { name: 'السعر: الأقل أولاً' }).click();
  await page.waitForURL(/sort=price_asc/);

  expect(new URL(page.url()).searchParams.has('cursor')).toBe(false);
});

/**
 * The filter panel is a disclosure on a phone and a permanent panel on a desktop.
 *
 * The desktop half is the one that broke silently: Chrome hides a closed `<details>` subtree with
 * `content-visibility` on `::details-content`, which no `display` on a descendant overrides. The
 * form computed `display: flex` with a 1911px box and was not rendered — and a height measurement
 * reported it as working.
 */
test('the filter panel opens on a desktop and collapses on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(SEARCH);
  await expect(page.locator('input[name="minPrice"]')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 850 });
  await expect(page.locator('input[name="minPrice"]')).toBeHidden();

  await page.locator('aside summary').click();
  await expect(page.locator('input[name="minPrice"]')).toBeVisible();
});

/**
 * A filter that can only ever empty the page is not offered.
 *
 * `unit_amenities` held zero rows while the catalogue listed twelve filterable amenities, so a
 * panel built from the catalogue would have given every visitor twelve checkboxes whose only
 * possible outcome is «لا نتائج» — which reads as a broken search, not as an untagged catalogue.
 *
 * Phrased as an INVARIANT rather than as "there are no amenities": the moment staff tag a stay,
 * this must keep passing, and it does — the assertion is that every amenity ON SCREEN reports a
 * count above zero, whatever the data happens to be on the day it runs.
 */
test('every amenity offered as a filter has at least one stay behind it', async ({
  page,
}) => {
  await page.goto(SEARCH);

  const counts = await page
    .locator('label:has(input[name="amenityCodes"])')
    .evaluateAll((labels) =>
      labels.map((label) =>
        Number(label.querySelector('span:last-child')?.textContent ?? '0'),
      ),
    );

  expect(counts.filter((count) => count <= 0)).toStrictEqual([]);
});

/**
 * «غرف النوم» — a requirement on the place, not a number of rooms to book.
 *
 * Driven through the popover rather than by typing a URL, because the stepper only exists after
 * hydration and the hidden input it writes is the whole mechanism. Three things have to hold and
 * each fails independently: the control writes the value, the search carries it, and the results
 * links keep it — a filter dropped on page two is a filter that silently widens itself.
 */
test('the bedrooms requirement reaches the search and survives its links', async ({
  page,
}) => {
  await page.goto('/ar');
  await page
    .getByRole('button', { name: /تحديد الإشغال/ })
    .first()
    .click();

  /* It starts at one and reads «غرفة» — never a zero, never «any» (Bashar, 2026-09-03). */
  await expect(page.locator('input[name="bedrooms"]').first()).toHaveValue('1');

  await page.getByRole('button', { name: 'زيادة غرف' }).click();

  /* The control writes what it shows. */
  await expect(page.locator('input[name="bedrooms"]').first()).toHaveValue('2');

  await page.getByRole('button', { name: 'تم' }).click();
  await page.getByRole('button', { name: /ابحث عن إقامة/ }).click();
  await page.waitForURL('**/search**');

  /* The search carries it… */
  expect(new URL(page.url()).searchParams.get('bedrooms')).toBe('2');

  /* …and so does every link the results page builds from its allow-list. */
  const sortLinks = await page
    .locator('a[href*="sort="]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));

  expect(sortLinks.length).toBeGreaterThan(0);
  expect(sortLinks.filter((href) => !href.includes('bedrooms=2'))).toStrictEqual([]);
});

/**
 * And zero means «any», so an ordinary search is untouched by the field existing.
 *
 * The regression half: a default of anything but zero, or a predicate applied when it is zero,
 * would narrow every search on the site — the kind of change that shows up as «fewer results than
 * yesterday» rather than as a failure.
 */
test('a search that does not ask for bedrooms is not narrowed by the field', async ({
  page,
}) => {
  await page.goto(SEARCH);

  const withoutTheField = await page.locator('article').count();

  await page.goto(`${SEARCH}&bedrooms=0`);

  expect(await page.locator('article').count()).toBe(withoutTheField);
  expect(withoutTheField).toBeGreaterThan(0);
});
