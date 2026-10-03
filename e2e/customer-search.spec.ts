import { expect, test, type Page } from '@playwright/test';

import { stayFrom } from './free-nights.js';

/**
 * The results page — loading on scroll, filtering, and what its own links are allowed to carry.
 *
 * Rewritten 2026-10-01 with the page (Bashar: «make it very similar as the one on booking.com …
 * implement a lazy loading when I scroll to the bottom. Do not use pagination»). Every intent the
 * paged version tested is kept and re-asked of the new shape: nothing beyond the first batch was
 * reachable once, filters once lost the search, links once reflected the request. None of these
 * would fail a unit test — the page renders, returns 200 and looks finished either way.
 */
test.use({ baseURL: 'http://localhost:3000' });

/**
 * A night the §5.3 cutoff cannot close — DERIVED, never written down. A frozen date became
 * yesterday on 2026-09-18 and failed five tests for a reason unrelated to the code.
 */
const { checkIn: CHECK_IN_DATE, checkOut: CHECK_OUT_DATE } = stayFrom(14, 2);
const STAY = `checkIn=${CHECK_IN_DATE}&checkOut=${CHECK_OUT_DATE}&adults=2`;
const CHECK_IN = new URLSearchParams(STAY).get('checkIn') ?? '';
const SEARCH = `/ar/search?${STAY}`;
/**
 * A search the map's feed answers WHOLE: Damascus, under the feed's cap of 250. The unfiltered
 * search places more than that, and a capped list reads 250 before a filter and 250 after it, so
 * «the filter narrowed it» and «the stays that charge to cancel are kept» cannot be asked of it.
 */
const UNDER_CAP = `${STAY}&citySlug=damascus`;

/** Results identified by LINK, never by name: the testbed shares names across many stays. */
const slugs = (page: Page) =>
  page
    .locator('main article h3 a[href*="/property/"]')
    .evaluateAll((links) =>
      links.map((link) => (link.getAttribute('href') ?? '').split('?')[0]),
    );

/** Scrolls until more cards than `beyond` are on the page, the way a reader reaches the end. */
async function scrollPast(page: Page, beyond: number): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.mouse.wheel(0, 6000);
        return page.locator('main article').count();
      },
      { message: 'scrolling to the end loads the next batch', timeout: 20_000 },
    )
    .toBeGreaterThan(beyond);
}

test('the results load as the reader scrolls, with no pages and no repeats', async ({
  page,
}) => {
  await page.goto(SEARCH);

  const first = await slugs(page);
  expect(first.length).toBeGreaterThan(0);

  /* No pager at all — the reader was explicit. */
  await expect(page.locator('a[rel="next"], a[rel="prev"]')).toHaveCount(0);

  await scrollPast(page, first.length);

  const loaded = await slugs(page);

  /* The first batch is still there, and nothing appears twice — offset paging can shift a row. */
  expect(loaded.slice(0, first.length)).toStrictEqual(first);
  expect(new Set(loaded).size).toBe(loaded.length);
  /* And no cursor leaked into the address: the view is the search, not a position in it. */
  expect(new URL(page.url()).searchParams.has('cursor')).toBe(false);
});

/**
 * «عرض التفاصيل» goes to the stay (Bashar, 2026-10-01: «the button is not clickable»).
 *
 * It was a span drawn as a button, painted ABOVE the card's stretched link by its own transform, so
 * a press on it landed nowhere while a press anywhere else on the card worked. Pressed by its
 * POSITION, as a finger does — a locator click on the title would pass whatever this does.
 */
test('the button on a card takes the reader to the stay', async ({ page }) => {
  await page.goto(SEARCH);

  const card = page.locator('main article').first();
  const button = card.getByText('عرض التفاصيل');
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) throw new Error('the card has no visible button');

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForURL(/\/ar\/property\//);
});

test('a filter applies at once, survives in the URL, and keeps the search', async ({
  page,
}) => {
  await page.goto(SEARCH);

  /* No «طبّق» button: ticking IS applying, as on booking.com. */
  await page.locator('aside input[name="freeCancellationOnly"]').check();
  await page.waitForURL(/freeCancellationOnly=true/);

  /* The dates and the party are not filters and must not be lost by filtering. */
  expect(page.url()).toContain(`checkIn=${CHECK_IN}`);
  expect(page.url()).toContain('adults=2');

  /* The panel comes back holding what was chosen, or the next change silently resets it. */
  await expect(page.locator('aside input[name="freeCancellationOnly"]')).toBeChecked();

  /* Clearing drops the filters and keeps the search. */
  await page.getByRole('link', { name: 'إزالة كل الخيارات' }).first().click();
  await page.waitForURL((url) => !url.searchParams.has('freeCancellationOnly'));
  expect(page.url()).toContain(`checkIn=${CHECK_IN}`);
});

/**
 * The page's own links, and the batches it asks for, carry only what the page understands.
 *
 * Scoped to the RESULTS: the footer's language picker carries the whole query string on purpose.
 */
test('a crafted parameter reaches neither the links nor the batches', async ({
  page,
}) => {
  await page.goto(`${SEARCH}&surprise=xyz123&attributes=notarealattribute`);

  const hrefs = await page
    .locator('main a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));

  expect(hrefs.length).toBeGreaterThan(0);
  expect(hrefs.filter((href) => href.includes('surprise'))).toStrictEqual([]);
  expect(hrefs.filter((href) => href.includes('notarealattribute'))).toStrictEqual([]);

  /* The next batch is asked for with the PARSED query, never the request's. */
  const batch = page.waitForRequest(/\/ar\/api\/search\?/);
  await page.mouse.wheel(0, 20_000);
  const asked = (await batch).url();

  expect(asked).not.toContain('surprise');
  expect(asked).not.toContain('notarealattribute');

  /* An unknown attribute does not survive into the panel's state, and results still render. */
  await expect(page.locator('aside input[name="attributes"]:checked')).toHaveCount(0);
  await expect(page.locator('main article').first()).toBeVisible();
});

test('changing the order starts the list again from the top', async ({ page }) => {
  await page.goto(SEARCH);
  await scrollPast(page, 20);

  /* The sort beside the heading, not the search bar's own selects above it. */
  await page
    .locator('section[aria-labelledby="results-heading"] select')
    .selectOption('price_asc');
  await page.waitForURL(/sort=price_asc/);

  /* A reorder is a new list: the first batch only, never a position carried into another order. */
  await expect.poll(() => page.locator('main article').count()).toBeLessThanOrEqual(20);
  expect(new URL(page.url()).searchParams.has('cursor')).toBe(false);
});

test('the filters are a sidebar on a desktop and a sheet on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(SEARCH);
  await expect(page.getByRole('heading', { name: 'ضيّق النتائج' }).first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 850 });
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const opener = page.getByRole('button', { name: /^التصفية/ });
  await opener.click();
  await expect(page.getByRole('dialog', { name: 'التصفية' })).toBeVisible();

  /* Escape dismisses, and focus returns to what opened it — modal in fact, not only in looks. */
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

/**
 * The sidebar card shows the MAP of the results, not a pattern standing in for one (Bashar,
 * 2026-10-01: «I can not see the map behind the button»), and still opens the full map.
 */
test('the map card draws the map of the results behind its button', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(SEARCH);

  const card = page.locator('[data-map-thumbnail]');
  await expect(card.locator('img[data-map-picture]')).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('OpenStreetMap');

  await card.getByRole('button', { name: 'شاهد على الخريطة' }).click();
  await expect(page.getByRole('dialog', { name: /خريطة/ })).toBeVisible();
  await page.keyboard.press('Escape');
});

/**
 * The full map shows every matching stay it can place, not the twenty cards of the page it was
 * opened from (Bashar, 2026-10-01: «I see only one price, while there are so many hotels»), with
 * the list of what is in view beside it, and the filters beside that.
 */
test.describe('the full map', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function openMap(page: Page, url = SEARCH) {
    await page.goto(url);
    await page.locator('[data-map-thumbnail] button').click();
    const dialog = page.getByRole('dialog', { name: 'الإقامات على الخريطة' });
    await expect(dialog).toBeVisible();
    const list = dialog.getByRole('region', { name: 'الإقامات في هذه المنطقة' });
    await expect(list.locator('li').first()).toBeVisible({ timeout: 15_000 });
    return { dialog, list };
  }

  test('lists every placed stay the search matches, and lights the pill of a card', async ({
    page,
    request,
  }) => {
    const feed = (await (
      await request.get(`/ar/api/search/map?${STAY}`, {
        headers: { accept: 'application/json' },
      })
    ).json()) as { stays: { slug: string }[] };

    expect(
      feed.stays.length,
      'the testbed has more than one placed stay',
    ).toBeGreaterThan(1);

    const { dialog, list } = await openMap(page);

    /* The opening view holds them all, so the list is the whole feed. */
    await expect(list.locator('li')).toHaveCount(feed.stays.length);
    await expect(
      /* Every plural form the catalogue has: «٢٥٠ إقامة» is the form past ten, and it is a real count. */
      dialog.getByText(/(\d+ (إقامات|إقامة)|إقامتان|إقامة واحدة) في هذه المنطقة/).first(),
    ).toBeVisible();

    await list.locator('li a').first().hover();
    await expect(dialog.locator('[data-map-pill][data-lit]')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  /*
    A stay opens in a NEW tab from every place the map offers it (Bashar, 2026-10-01): the card,
    the price pill and the dot, so the area the reader found is still there when they come back.
  */
  test('opens a stay in a new tab and keeps the map where it was', async ({
    page,
    context,
  }) => {
    const { dialog, list } = await openMap(page);

    const opened = context.waitForEvent('page');
    await list.locator('li a').first().click();
    const tab = await opened;

    await expect(tab).toHaveURL(/\/ar\/property\//);
    await expect(dialog, 'the map is still open behind the new tab').toBeVisible();
    await tab.close();

    /* Every pill and every dot opens the same way; none of them navigates the map away. */
    const targets = await dialog
      .locator('a[href*="/property/"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('target')));
    expect(targets.length).toBeGreaterThan(1);
    expect(new Set(targets)).toEqual(new Set(['_blank']));
  });

  /*
    Every card beside the map carries the heart (Bashar, 2026-10-01). It sits above the card's
    stretched link, so pressing it SAVES: signed out, it leads to sign-in in this tab and back to this
    search, and it never opens the stay in a new one.
  */
  test('a heart on a map card saves rather than opening the stay', async ({
    page,
    context,
  }) => {
    const { list } = await openMap(page);

    const hearts = list.getByRole('button', { name: /^احفظ / });
    await expect(hearts).toHaveCount(await list.locator('li').count());

    let opened = false;
    context.on('page', () => {
      opened = true;
    });

    await hearts.first().click();
    await page.waitForURL('**/login**');

    const back = new URL(
      decodeURIComponent(new URL(page.url()).searchParams.get('next') ?? ''),
      'http://localhost:3000',
    );
    expect(back.pathname).toBe('/ar/search');
    expect(back.searchParams.get('checkIn')).toBe(CHECK_IN);
    expect(opened, 'the heart did not open the stay in a new tab').toBe(false);
  });

  test('a filter beside the map narrows the map and keeps it open', async ({ page }) => {
    const { dialog, list } = await openMap(page, `/ar/search?${UNDER_CAP}`);
    const before = await list.locator('li').count();

    const filters = dialog.getByRole('complementary', {
      name: 'تصفية الإقامات على الخريطة',
    });
    await filters
      .getByRole('checkbox', { name: /إلغاء دون رسوم/ })
      .first()
      .check();

    /* The box ticks at once; the URL follows the server's render, which a cold server takes a while over. */
    await expect(page).toHaveURL(/freeCancellationOnly=true/, { timeout: 15_000 });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => list.locator('li').count(), { timeout: 15_000 })
      .toBeLessThan(before);
  });
});

/*
  «false» is a word, and the API's parser once read every word as true: the page's
  `freeCancellationOnly=false` hid every stay without free cancellation, on the list and the map.
*/
test('an unfiltered search keeps the stays that charge to cancel', async ({
  request,
}) => {
  const read = async (query: string) =>
    (
      (await (
        await request.get(`/ar/api/search/map?${query}`, {
          headers: { accept: 'application/json' },
        })
      ).json()) as { stays: { freeCancellation: string | null }[] }
    ).stays;

  const all = await read(UNDER_CAP);
  const free = await read(`${UNDER_CAP}&freeCancellationOnly=true`);

  expect(
    all.some((stay) => stay.freeCancellation === null),
    'the testbed has a stay that charges to cancel, and the unfiltered search shows it',
  ).toBe(true);
  /* The opposite control: switched on, the filter still filters. */
  expect(free.length).toBeGreaterThan(0);
  expect(free.every((stay) => stay.freeCancellation !== null)).toBe(true);
});

/**
 * A filter that can only ever empty the page is not offered — as an INVARIANT: every amenity on
 * screen reports a count above zero, whatever the data happens to be on the day it runs.
 */
test('every amenity offered as a filter has at least one stay behind it', async ({
  page,
}) => {
  await page.goto(SEARCH);

  const counts = await page
    .locator('aside label:has(input[name="amenityCodes"])')
    .evaluateAll((labels) =>
      labels.map((label) =>
        Number(label.querySelector('span:last-child')?.textContent ?? '0'),
      ),
    );

  expect(counts.filter((count) => count <= 0)).toStrictEqual([]);
});

/**
 * «غرف النوم» — a requirement on the place. It has to reach the search AND every later batch: a
 * requirement dropped by the second batch is one that silently widens itself while scrolling.
 */
test('the bedrooms requirement reaches the search and every batch after it', async ({
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
  await expect(page.locator('input[name="bedrooms"]').first()).toHaveValue('2');

  await page.getByRole('button', { name: 'تم' }).click();
  await page.getByRole('button', { name: /ابحث عن إقامة/ }).click();
  await page.waitForURL('**/search**');

  expect(new URL(page.url()).searchParams.get('bedrooms')).toBe('2');

  if ((await page.locator('main article').count()) >= 20) {
    const batch = page.waitForRequest(/\/ar\/api\/search\?/);
    await page.mouse.wheel(0, 20_000);
    expect(new URL((await batch).url()).searchParams.get('bedrooms')).toBe('2');
  }
});

/**
 * نوع العقار on the bar reaches the search, and the two controls on `/search` agree — the bar must
 * not read «كل الأنواع» over a filtered list, or searching again silently clears the filter.
 */
test('نوع العقار reaches the search, and the bar and the sidebar agree', async ({
  page,
}) => {
  await page.goto('/ar');

  const field = page.locator('#q-type');
  await expect(field, 'the bar offers the type').toBeVisible();
  await expect(field).toHaveAttribute('name', 'propertyTypeCode');
  await expect(field.locator('option').first()).toHaveAttribute('value', '');

  await field.selectOption('hotel');
  await page.getByRole('button', { name: /ابحث عن إقامة/ }).click();
  await page.waitForURL('**/search**');

  expect(new URL(page.url()).searchParams.get('propertyTypeCode')).toBe('hotel');
  await expect(page.locator('#q-type')).toHaveValue('hotel');
  await expect(
    page.locator('aside input[name="propertyTypeCode"][value="hotel"]').first(),
  ).toBeChecked();
});

test('choosing no type leaves the search as wide as it was', async ({ page }) => {
  await page.goto(SEARCH);
  const unfiltered = await page.locator('main article').count();
  await page.goto(`${SEARCH}&propertyTypeCode=`);
  expect(await page.locator('main article').count()).toBe(unfiltered);
  expect(unfiltered).toBeGreaterThan(0);
});

test('a search that does not ask for bedrooms is not narrowed by the field', async ({
  page,
}) => {
  await page.goto(SEARCH);
  const withoutTheField = await page.locator('main article').count();
  await page.goto(`${SEARCH}&bedrooms=0`);
  expect(await page.locator('main article').count()).toBe(withoutTheField);
  expect(withoutTheField).toBeGreaterThan(0);
});

/**
 * Opening a stay and coming back returns the reader to it — the rule every list a person can click
 * into keeps. On an infinite list the loaded batches have to come back too, or the card they opened
 * no longer exists on the page they return to. Tested against a card from a LATER batch, because
 * the first batch is there whether or not anything works.
 */
test('coming back from a stay returns to it, with what was loaded', async ({ page }) => {
  await page.goto(SEARCH);
  const firstBatch = await page.locator('main article').count();
  test.skip(
    firstBatch < 20,
    'the testbed has fewer than one batch of stays for these dates',
  );

  await scrollPast(page, firstBatch);

  const target = page.locator('main article').nth(firstBatch + 2);
  const id = await target.getAttribute('id');
  await target.locator('h3 a').click();
  await page.waitForURL(/\/property\//);

  await page.goBack();
  await page.waitForURL(/\/search/);

  const back = page.locator(`[id="${id}"]`);
  await expect(back, 'the opened card is on the page again').toHaveCount(1);
  await expect(
    back,
    'brought into view, not left at the edge it was pressed at',
  ).toBeInViewport({ ratio: 0.8 });
});

test('the batch route sends a browser to the page, and refuses a malformed cursor', async ({
  page,
  request,
}) => {
  /* A pasted or opened batch URL is never a JSON body in front of a person. */
  await page.goto(`/ar/api/search?${STAY}&cursor=MjA`);
  expect(new URL(page.url()).pathname).toBe('/ar/search');

  const refused = await request.get(
    `/ar/api/search?${STAY}&cursor=${encodeURIComponent('a b')}`,
    {
      headers: { Accept: 'application/json' },
    },
  );
  expect(refused.status()).toBe(400);
});

/**
 * Saving a listing while signed out sends you to sign in — it does not lie about a failure. On the
 * CARD now as well as on the listing: the heart answers a 401 by going to sign-in and back.
 */
test('saving a stay while signed out leads to sign-in, not to an error', async ({
  page,
}) => {
  await page.goto(SEARCH);

  await page
    .locator('main article')
    .first()
    .getByRole('button', { name: /^احفظ / })
    .click();
  await page.waitForURL('**/login**');

  const back = new URL(
    decodeURIComponent(new URL(page.url()).searchParams.get('next') ?? ''),
    'http://localhost:3000',
  );

  /* Back to the same search, with its dates and party intact. */
  expect(back.pathname).toBe('/ar/search');
  expect(back.searchParams.get('checkIn')).toBe(CHECK_IN);
  expect(back.searchParams.get('adults')).toBe('2');
  await expect(page.getByText(/تعذّر الحفظ/)).toHaveCount(0);
});
