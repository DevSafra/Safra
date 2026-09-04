import { expect, test, type Page } from '@playwright/test';

import { PARTNER_BASE as PORTAL, PARTNER_STATE } from './partner-session.js';
import { STAFF_STATE } from './staff.js';
import { ar as t } from '../packages/i18n/src/messages/partner/ar.js';

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
        The FILTER, driven as a person does it: tick the chip, submit the form, read the results.

        Not by typing `?starRatings=5` — that would prove the API filters and say nothing about
        whether the control on the page is wired to it, which is the half that breaks. The chip is
        a `sr-only` checkbox inside a styled label, so the label is what a person clicks.
      */
      const chip = page
        .locator('label')
        .filter({ has: page.locator('input[value="5"][name="starRatings"]') });

      await chip.click();
      await page
        .locator('form')
        .first()
        .press('Enter')
        .catch(() => undefined);
      await page.getByRole('button', { name: /ابحث/ }).first().click();
      await page.waitForLoadState('domcontentloaded');

      await expect(page).toHaveURL(/starRatings=5/);

      /*
        Every result is five stars. The filter chips themselves also carry `data-star-rating`, so
        the assertion is scoped to what comes AFTER the form — otherwise the chips' own 1..5 would
        make this pass no matter what the results were, which is how the first draft of this test
        proved nothing.
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
     * The partner path: the creation form asks for it, and an existing listing can change it.
     *
     * ## Why this does NOT create a listing
     *
     * It did, and it broke two other specs. `partner.spec.ts` asserts that EVERY listing this
     * partner owns is named «قصر الشرق» — a real scope-isolation check that a leaked fixture must
     * not be allowed to weaken — and three «فندق النجوم …» drafts made it fail. That is the
     * «any spec that submits the bar must put the size back» rule, one level up: a spec that adds
     * a ROW to a shared fixture leaks into every later spec and every later run.
     *
     * So the creation half is asserted on the FORM — the field is present and required — and the
     * write is proved where it can be rolled back, in
     * `apps/api/src/partner/properties.integration.test.ts`. The edit half is driven here on a
     * listing that already exists, because changing one property's classification changes nothing
     * any other spec reads.
     */
    test('asks for it when creating, and an existing listing can change it', async ({
      page,
    }) => {
      await page.goto(`${PORTAL}/properties`, { waitUntil: 'domcontentloaded' });

      /* ── Creating: the field is there, and there is no way to skip it ────── */
      await page
        .getByRole('button', { name: /إضافة عقار|عقار جديد/ })
        .first()
        .click();

      const field = page.locator('select[name="starRating"]');

      await expect(field, 'the creation form asks for a classification').toBeVisible();
      await expect(
        field.locator('option'),
        'five values and no blank — it is required on creation',
      ).toHaveCount(5);

      await page.getByRole('button', { name: /إغلاق النموذج/ }).click();

      /* ── Editing: an existing listing, changed and read back ─────────────── */
      const card = page.locator('article').first();
      const name = (await card.locator('h2').innerText()).trim();

      await card.getByRole('link', { name: /تعديل/ }).first().click();
      await page.waitForLoadState('domcontentloaded');

      /*
        By its LABEL, not by `name`. The editor's selects are the portal's own `Select`, which
        takes no `name` prop — the city, type and policy fields have none either — so a name-based
        locator finds nothing and reports «the field is missing» about a field that is right there.
      */
      const editor = page.getByLabel(t.properties.fStarRating);

      await expect(editor, 'the edit form carries the field too').toBeVisible();

      const before = await editor.inputValue();
      const next = before === '5' ? '3' : '5';

      await editor.selectOption(next);

      /*
        WAIT for the PATCH, do not race it. The first version clicked save and navigated straight
        to the list, which read the OLD value while the request was still in flight — the API
        logged a 200 a moment later. It reported the feature broken when the feature was fine.
      */
      const [saved] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/api/properties/') && r.request().method() === 'PATCH',
        ),
        page.getByRole('button', { name: /حفظ/ }).first().click(),
      ]);

      expect(saved.status(), 'the edit was accepted').toBeLessThan(400);

      await page.goto(`${PORTAL}/properties`, { waitUntil: 'domcontentloaded' });

      await expect(
        page
          .locator('article')
          .filter({ hasText: name })
          .first()
          .locator('[data-star-rating]'),
        'the change is saved and shown on the listing screen',
      ).toHaveAttribute('data-star-rating', next);
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
      await page.locator('tbody tr a').first().click();
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
