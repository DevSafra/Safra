import { expect, test } from '@playwright/test';

import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * كتالوج المنصّة — the three reference sets a business manages (Bashar, 2026-09-04).
 *
 * ## Why this spec exists
 *
 * `amenities`, `cancellation_policies` and `partner_types` were read across the whole platform and
 * written NOWHERE: adding an amenity meant SQL against production. Bashar: *"I do not want normal
 * business operations to depend on direct SQL or migrations where an administrator should
 * reasonably be able to manage the data through the platform."*
 *
 * ## It creates and then removes what it created
 *
 * Repeatable by construction rather than by cleanup. The probe amenity is deleted at the end, and
 * because deleting is refused for anything in use, a probe that somehow acquired a link would fail
 * loudly here rather than leave a row behind for the next run to trip over.
 */
const PROBE = 'e2e-probe-amenity';

test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.use({ storageState: STAFF_STATE, viewport: { width: 1440, height: 900 } });

test('the three catalogues are on one screen, each with its counts', async ({ page }) => {
  await page.goto('/catalogue', { waitUntil: 'domcontentloaded' });

  const main = page.locator('main');

  await expect(main).toContainText('الخدمات والمرافق');
  await expect(main).toContainText('سياسات الإلغاء');
  await expect(main).toContainText('أنواع الشركاء');

  /* The sentence that stops a costly misunderstanding about editing a refund ladder. */
  await expect(
    main,
    'the policy note says an edit moves future bookings only',
  ).toContainText('الحجوزات القادمة فقط');

  /* Every seeded row is drawn, not just the headings. */
  await expect(page.locator('[data-amenity-edit]').first()).toBeVisible();
  await expect(page.locator('[data-policy-edit]').first()).toBeVisible();
  await expect(page.locator('[data-partner-type-edit]').first()).toBeVisible();

  await page.screenshot({ path: 'test-results/catalogue.png', fullPage: true });
});

test('an amenity can be created, retired and deleted', async ({ page }) => {
  await page.goto('/catalogue', { waitUntil: 'domcontentloaded' });

  /* Left behind by a failed run: remove it so this one measures its own work. */
  if ((await page.locator(`[data-amenity-edit="${PROBE}"]`).count()) > 0) {
    await page.locator(`[data-amenity-edit="${PROBE}"]`).click();
    await page.getByRole('button', { name: 'حذف' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'تأكيد' }).click();
    await expect(page.locator(`[data-amenity-edit="${PROBE}"]`)).toHaveCount(0);
  }

  // ── Create ──
  await page.locator('[data-amenity-add]').click();

  const form = page.locator('[data-amenity-form="add"]');

  await form.getByLabel('المعرّف').fill(PROBE);
  await form.getByLabel('الاسم بالعربية').fill('خدمة اختبار');

  const created = page.waitForResponse(
    (r) =>
      r.url().includes('/api/catalogue/amenities') && r.request().method() === 'POST',
  );

  await form.locator('[data-geo-save]').click();
  expect((await created).status(), 'the API accepted it').toBeLessThan(300);

  const row = page.locator(`[data-amenity-edit="${PROBE}"]`);

  await expect(row, 'and it is on the screen').toBeVisible({ timeout: 15_000 });

  // ── Retire it, and confirm the two flags are separate ──
  await row.click();

  const editor = page.locator(`[data-amenity-form="${PROBE}"]`);

  await editor.getByText('مفعَّلة — يستطيع الشريك اختيارها').click();

  const retired = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/catalogue/amenities/${PROBE}`) &&
      r.request().method() === 'PATCH',
  );

  await editor.locator('[data-geo-save]').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'تأكيد' }).click();
  expect((await retired).status()).toBeLessThan(300);

  await page.goto('/catalogue', { waitUntil: 'domcontentloaded' });

  /*
    The `<tr>` the edit button sits in. `AdminTable` marks rows with `id={rowAnchor(code)}` rather
    than a data attribute, and anchoring on the button is what keeps this working whichever the
    table decides to use.
  */
  const rowText = await page
    .locator('tr')
    .filter({ has: page.locator(`[data-amenity-edit="${PROBE}"]`) })
    .innerText();

  console.log(`--- ${PROBE} after retiring ---\n${rowText}`);

  /*
    Retired, but still filterable: the two flags are separate, and the row shows both. Conflating
    them would let somebody tidying the search sidebar stop partners declaring a real facility.
  */
  expect(rowText, 'it is retired').toContain('موقوف');
  expect(rowText, 'and still marked filterable').toContain('مفعَّل');

  // ── Delete it ──
  await page.locator(`[data-amenity-edit="${PROBE}"]`).click();

  const removed = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/catalogue/amenities/${PROBE}`) &&
      r.request().method() === 'DELETE',
  );

  await page.getByRole('button', { name: 'حذف' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'تأكيد' }).click();
  expect((await removed).status()).toBeLessThan(300);

  await expect(page.locator(`[data-amenity-edit="${PROBE}"]`)).toHaveCount(0);
});

/**
 * Deleting one IN USE is not driven here, and the reason is worth writing down.
 *
 * `unit_amenities` is **empty on every database**: the API accepts `amenityCodes` on a unit and
 * the partner portal has never sent it, so no listing declares any amenity and there is nothing
 * for a browser test to find in use. The first version of this file looked for one, found `wifi`
 * with a count of zero, and **soft-deleted a seeded amenity** — the refusal it was written to
 * assert could not fire.
 *
 * The rule itself is held by `catalogue.integration.test.ts`, which CREATES the link it needs
 * instead of looking for one, and was watched to fail when the guard was removed. A browser test
 * that skips on missing fixture data proves nothing and reports coverage, which is worse than its
 * absence — so it is absent, and this note is why.
 *
 * The gap it exposed (a catalogue nothing can be applied from) is recorded in `docs/FUTURE-WORK.md`.
 */
