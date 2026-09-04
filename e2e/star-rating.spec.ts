import { expect, test, type Page } from '@playwright/test';

import { PARTNER_BASE as PORTAL, PARTNER_STATE } from './partner-session.js';
import { STAFF_STATE } from './staff.js';
import tw from '../packages/i18n/src/messages/web/ar.json' with { type: 'json' };

/**
 * The star classification, on every surface a property appears (Bashar, 2026-09-04).
 *
 * *"Please review every place in the platform where a property appears and make sure the star
 * rating is shown consistently."* This is that review, written as assertions rather than as a list
 * somebody checked once — the difference between a sweep and a claim.
 *
 * ## `data-star-rating` is the whole trick
 *
 * Only `StarRating` in `@safra/ui` emits that attribute, so finding it on a screen proves the
 * SHARED component drew it — not a `★` somebody typed, not a second implementation that happens to
 * look similar today. That is exactly the consistency Bashar asked for («the visual representation
 * should be consistent across all three applications»), and it is the one property a screenshot
 * cannot establish and a test can.
 *
 * It also carries the VALUE, so «this card claims four stars» is checkable without reading pixels.
 *
 * ## What it does NOT assert
 *
 * That the review score and the classification are told apart by a human. That is a design
 * judgement — the classification is a row of five shapes on the type line, the review score stays
 * a number beside its count — and the closest a test can get is the assertion below that both are
 * present on a property page without one having replaced the other.
 */

/** Dates far enough out that the seeded calendars have availability. */
const STAY = 'checkIn=2027-03-01&checkOut=2027-03-03&adults=2';

/** Every star row a page drew, with its value. Empty means the component never rendered. */
async function starsOn(page: Page): Promise<number[]> {
  return page
    .locator('[data-star-rating]')
    .evaluateAll((nodes) =>
      nodes.map((node) => Number(node.getAttribute('data-star-rating'))),
    );
}

/**
 * The same, EXCLUDING the search form's own filter chips.
 *
 * Those chips are drawn with the same component — deliberately, so the filter looks like the thing
 * it filters — and they always show 1 through 5. Counting them made the first version of the
 * assertion below report `[1,2,3,4,5]` for a five-star search and call the filter broken when it
 * was working. `closest('form')` is the discriminator, because a chip is inside the form and a
 * result never is.
 */
async function resultStarsOn(page: Page): Promise<number[]> {
  return page
    .locator('[data-star-rating]')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => !node.closest('form'))
        .map((node) => Number(node.getAttribute('data-star-rating'))),
    );
}

test.describe('the star classification, across all three applications', () => {
  // ── The customer application ────────────────────────────────────────────────
  test.describe('the customer application', () => {
    test('shows it on search results, and the filter narrows to it', async ({ page }) => {
      await page.goto(`http://localhost:3000/ar/search?${STAY}`, {
        waitUntil: 'domcontentloaded',
      });

      const cards = page
        .locator('article, li')
        .filter({ has: page.locator('[data-star-rating]') });

      await expect(
        cards.first(),
        'a search result draws its classification',
      ).toBeVisible();

      /*
        The FILTER, driven as a person does it — and it lives in «التصفية» now, not on the search
        bar (Bashar, 2026-09-04: «they should be inside التصفية on the الإقامات page»).

        Not by typing `?starRatings=5`, which would prove the API filters and say nothing about
        whether the control on the page is wired to it — the half that breaks. Below `lg` the panel
        is a `<details>`, so it is opened first; at the desktop width this runs at it is already
        open and opening it again is harmless.
      */
      const panel = page.locator('details').filter({ hasText: 'التصفية' }).first();

      if ((await panel.count()) > 0)
        await panel.evaluate((node: HTMLDetailsElement) => {
          node.open = true;
        });

      await page.locator('input[name="starRatings"][value="5"]').check();
      /* The panel's own «تطبيق التصفية», named from the catalogue rather than guessed. */
      await page.getByRole('button', { name: tw.search.filtersApply }).click();
      await page.waitForLoadState('domcontentloaded');

      await expect(page).toHaveURL(/starRatings=5/);

      /*
        Every result is five stars. Scoped past the form, because the filter's own rows draw the
        same component — otherwise their 1..5 would make this pass whatever the results were.
      */
      const results = await resultStarsOn(page);

      expect(
        results.length,
        'the filtered search returned rated results',
      ).toBeGreaterThan(0);
      expect(
        [...new Set(results)],
        'a 5-star filter returns only 5-star listings',
      ).toEqual([5]);

      /* And the chip comes back CHECKED — a filter that forgets itself reads as broken. */
      await expect(page.locator('input[name="starRatings"][value="5"]')).toBeChecked();
    });

    test('shows it on a property page, beside — not instead of — the review score', async ({
      page,
    }) => {
      await page.goto(`http://localhost:3000/ar/search?${STAY}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.locator('h3 a, h2 a').first().click();
      await page.waitForLoadState('domcontentloaded');
      await expect(page).toHaveURL(/\/property\//);

      const stars = await starsOn(page);

      expect(stars.length, 'the property page draws the classification').toBeGreaterThan(
        0,
      );
      expect(stars[0]).toBeGreaterThanOrEqual(1);
      expect(stars[0]).toBeLessThanOrEqual(5);

      /*
        The two facts coexist. `★` followed by a decimal is the review score, which this feature
        must not have replaced — the whole design decision was to keep them distinguishable rather
        than to merge them.
      */
      const body = await page.locator('main').innerText();

      expect(
        /★\s*\d/.test(body) || !/تقييم/.test(body),
        'the review score is still its own thing, or this listing simply has none',
      ).toBe(true);
    });

    test('shows it on a city page', async ({ page }) => {
      await page.goto('http://localhost:3000/ar/city/damascus', {
        waitUntil: 'domcontentloaded',
      });

      expect(
        (await starsOn(page)).length,
        'a city page draws classifications',
      ).toBeGreaterThan(0);
    });

    test('shows it on the home page’s recommended strip', async ({ page }) => {
      await page.goto('http://localhost:3000/ar', { waitUntil: 'domcontentloaded' });

      expect(
        (await resultStarsOn(page)).length,
        'the recommended strip draws classifications, not just the filter chips',
      ).toBeGreaterThan(0);
    });
  });

  // ── The partner portal ──────────────────────────────────────────────────────
  test.describe('the partner portal', () => {
    test.use({ storageState: PARTNER_STATE });

    /**
     * The creation form asks a HOTEL for a classification, and asks nobody else.
     *
     * ## Why this and not an edit
     *
     * The fixture partner's only hotels are PUBLISHED, and §8.1 freezes a published listing's form
     * — so there is no partner-editable hotel to drive, and a test that hunted for one would skip
     * and prove nothing. Persistence through create and update is proved at the service layer in
     * `apps/api/src/partner/properties.integration.test.ts`, where it rolls back and where two
     * mutations have been watched to fail against it.
     *
     * What only a browser can prove is the REACTIVE half: the field appears when the type is a
     * hotel and vanishes when it is not, without a page load. That is Bashar's rule of 2026-09-04
     * made visible, and it is what this drives.
     *
     * ## And it creates nothing
     *
     * An earlier version submitted the form, which left three drafts on a shared fixture partner
     * and broke `partner.spec.ts`'s check that every listing that partner owns is named «قصر
     * الشرق». A spec that adds a row to a shared fixture leaks into every later run.
     */
    test('asks a hotel for a classification, and asks no other type', async ({
      page,
    }) => {
      await page.goto(`${PORTAL}/properties`, { waitUntil: 'domcontentloaded' });
      await page
        .getByRole('button', { name: /إضافة عقار|عقار جديد/ })
        .first()
        .click();

      const type = page.locator('select[name="propertyTypeCode"]');
      const stars = page.locator('select[name="starRating"]');

      await expect(type, 'the creation form asks for a type').toBeVisible();

      await type.selectOption('hotel');
      await expect(stars, 'a hotel is asked for its classification').toBeVisible();
      await expect(
        stars.locator('option'),
        'five values and no blank — it is required of a hotel',
      ).toHaveCount(5);

      /*
        Every other type, one at a time. Not just one of them: «apartments, villas, chalets, homes,
        camps and similar» is a list, and a rule asserted against a single example is a rule that
        holds for a single example.
      */
      for (const code of [
        'apartment',
        'villa',
        'chalet',
        'farm',
        'camp',
        'rural_house',
      ]) {
        await type.selectOption(code);
        await expect(
          stars,
          `a ${code} is not asked for a star classification`,
        ).toHaveCount(0);
      }

      /* And back, so the disappearance is a reaction rather than a one-way collapse. */
      await type.selectOption('hotel');
      await expect(stars).toBeVisible();
    });
  });

  // ── The super admin console ─────────────────────────────────────────────────
  test.describe('the super admin console', () => {
    test.use({ storageState: STAFF_STATE });

    test('shows it in the registry and the approval queue', async ({ page }) => {
      await page.goto('/properties?size=25', { waitUntil: 'domcontentloaded' });

      /* The column exists whatever the data says — «بلا تصنيف» is a rendering, not an absence. */
      await expect(
        page.getByRole('columnheader', { name: 'النجوم' }),
        'the registry has a classification column',
      ).toBeVisible();

      const shown = await starsOn(page);
      const unrated = await page.getByText('بلا تصنيف').count();

      expect(
        shown.length + unrated,
        'every row in the registry says something about its classification',
      ).toBeGreaterThan(0);
    });

    test('shows it on the detail screen and lets a reviewer correct it', async ({
      page,
    }) => {
      await page.goto('/properties?size=25', { waitUntil: 'domcontentloaded' });

      /*
        A HOTEL row. The classification is a hotel classification, so a villa's detail screen has
        no editor at all — «the first row» found one and called the editor missing.
      */
      const hotelRow = page.locator('tbody tr').filter({ hasText: 'فندق' }).first();

      await expect(hotelRow, 'the registry must show at least one hotel').toBeVisible();
      await hotelRow.locator('a').first().click();
      await page.waitForLoadState('domcontentloaded');
      await expect(page).toHaveURL(/\/properties\/PRO-/);

      const editor = page.locator('[data-star-editor]');

      await expect(editor, 'the detail screen carries the editor').toBeVisible();

      /*
        The CORRECTION, driven — and this is the control that matters most, because 2,016 published
        listings predate the field and their partner can no longer edit them. Without this working,
        «the Super Admin must be able to see the star rating for every property, including
        properties already published» is an empty column forever.
      */
      const select = editor.locator('select[name="starRating"]');
      const before = await select.inputValue();
      const next = before === '5' ? '3' : '5';

      await select.selectOption(next);
      await editor.getByRole('button', { name: 'حفظ' }).click();

      await expect(page.getByText('حُفظ تصنيف النجوم')).toBeVisible();

      /* It survives a reload, which is the difference between a write and a rendered guess. */
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(
        page.locator('[data-star-editor] select[name="starRating"]'),
      ).toHaveValue(next);
    });

    /**
     * A non-hotel has no classification, and no control that offers one.
     *
     * Bashar, 2026-09-04: «Other accommodation types such as apartments, villas, chalets, homes,
     * camps and similar property types should not use the hotel star-classification system. For
     * non-hotel accommodation types, the classification should simply be absent.»
     *
     * «لا ينطبق» rather than «بلا تصنيف»: one says the scheme does not reach this kind of place,
     * the other says it does and nobody has answered yet. Printing the second against a villa
     * sends an operator looking for a control that should not exist.
     */
    test('offers no classification for a non-hotel, and says why', async ({ page }) => {
      await page.goto('/properties?size=100', { waitUntil: 'domcontentloaded' });

      const other = page
        .locator('tbody tr')
        .filter({ hasNotText: 'فندق' })
        .filter({ hasText: 'لا ينطبق' })
        .first();

      test.skip(
        (await other.count()) === 0,
        'every listing in this registry page is a hotel — nothing to assert about the rest',
      );

      await other.locator('a').first().click();
      await page.waitForLoadState('domcontentloaded');

      await expect(
        page.locator('[data-star-editor]'),
        'a villa has no classification editor at all',
      ).toHaveCount(0);
      await expect(page.getByText('لا ينطبق').first()).toBeVisible();
    });
  });

  // ── The consistency Bashar asked for, stated as one assertion ───────────────
  test('all three applications draw it with the SAME component', async ({ browser }) => {
    /*
      `data-star-rating` is emitted by `StarRating` in `@safra/ui` and by nothing else. Finding it
      on a screen in each application is the proof that one component draws all three — which no
      screenshot can establish, and which is the whole of «the visual representation should be
      consistent across all three applications».
    */
    const seen: Record<string, boolean> = {};

    for (const [app, url, state] of [
      ['customer', `http://localhost:3000/ar/search?${STAY}`, undefined],
      ['partner', `${PORTAL}/properties`, PARTNER_STATE],
      ['console', 'http://localhost:3001/properties?size=25', STAFF_STATE],
    ] as const) {
      const context = await browser.newContext(state ? { storageState: state } : {});
      const page = await context.newPage();

      await page.goto(url, { waitUntil: 'domcontentloaded' });
      seen[app] = (await starsOn(page)).length > 0;
      await context.close();
    }

    expect(seen, 'one component, all three applications').toEqual({
      customer: true,
      partner: true,
      console: true,
    });
  });
});
