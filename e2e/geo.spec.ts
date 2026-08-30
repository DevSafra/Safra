import { expect, test } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * المدن والدول والعملات — the three things it could not do (Bashar, 2026-08-30).
 *
 * ## What a browser adds
 *
 * `geo-write.integration.test.ts` proves the writes, their refusals and their audit rows against a
 * real database. What it cannot see is whether an operator can DO any of it: the screen showed
 * three disabled «+ إضافة» buttons and a table whose every row was a dead end, and the city image
 * pipeline was built end-to-end with nothing calling either end.
 *
 * ## It leaves a photograph behind, deliberately
 *
 * `city_images` is append-only-with-a-soft-delete, so a spec cannot tidy up after itself. It
 * uploads one every run, which is the only way to keep testing the path — the same trade
 * `partner-support.spec.ts` documents. `db:testbed` clears them.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.use({ storageState: STAFF_STATE });

const c = t.sections.geo;

test('the three add controls are real, not disabled placeholders', async ({ page }) => {
  await page.goto('/geo');

  for (const marker of ['currency', 'country', 'city']) {
    const trigger = page.locator(`[data-geo-add="${marker}"]`);

    await expect(trigger, `«+ إضافة» for ${marker} must be a control`).toBeEnabled();

    /* And it opens a real form — a trigger that expands nothing is the shape being replaced. */
    await trigger.click();
    await expect(page.locator(`[data-geo-form="${marker}"]`)).toBeVisible();
    await page.getByRole('button', { name: c.cancel }).first().click();
  }
});

/**
 * A city row opens an editor, and the editor takes a photograph.
 *
 * `city_images`, its `GEO_MANAGE` controller and the re-encoding worker all existed and nothing
 * called them: nine cities, zero rows, and §5.4's hero band rendering a gradient. The count on the
 * row is the cheapest proof the upload landed AND that the read sees it.
 */
test('a city can be edited, and given the photograph §5.4 asks for', async ({ page }) => {
  await page.goto('/geo');

  const marker = page.locator('[data-city-images="damascus"]');
  const before = ((await marker.textContent()) ?? '').trim();

  await page.locator('[data-city-edit="damascus"]').click();

  /*
    The form opens BELOW the table at full width, not inside a cell. It was rendered in the cell
    first: a five-track grid given six columns squeezes every track, «البتراء» came out «تراء», and
    the form folded into a 40px column and stretched two thousand pixels down the page.
  */
  const form = page.locator('[data-city-form="damascus"]');

  await expect(form).toBeVisible();
  expect(
    (await form.boundingBox())?.width ?? 0,
    'the editor is a panel, not a table cell',
  ).toBeGreaterThan(400);

  const chooser = page.waitForEvent('filechooser');

  await page.locator('[data-city-image-add="damascus"]').click();
  await (await chooser).setFiles('e2e/fixtures/room-one.jpg');

  await expect
    .poll(async () => ((await marker.textContent()) ?? '').trim(), { timeout: 30_000 })
    .not.toBe(before);
});

/**
 * And the photograph reaches the PUBLIC page, which is the point of uploading it.
 *
 * The bucket policy grants anonymous read per prefix, and `cities/*` was absent — the failure is
 * silent in the worst way: URL right, object stored, row `ready`, browser rendering nothing.
 * `media-policy.integration.test.ts` holds the policy; this holds the page that depends on it.
 */
test('the city hero is a photograph, and it loads', async ({ page, request }) => {
  await page.goto('http://localhost:3000/ar/city/damascus');

  const hero = page.locator('section img').first();

  /* Skip only if the city genuinely has none — never because the picture failed to arrive. */
  test.skip((await hero.count()) === 0, 'Damascus has no photograph yet.');

  const src = (await hero.getAttribute('src')) ?? '';

  expect(src).toContain('/cities/');

  /* The bytes, not the tag: an `<img>` whose source 403s renders nothing and reports no error. */
  expect((await request.get(src)).status(), `${src} must be readable`).toBe(200);

  await expect
    .poll(async () => hero.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
});
