import { expect, test } from '@playwright/test';

import { partnerAr as t } from '../packages/i18n/src/partner.js';
import { PARTNER_BASE as BASE, PARTNER_STATE } from './partner-session.js';

/**
 * §6.5's lookup — «إذا لم يكن لدى العميل إنترنت، يستطيع الشريك البحث برقم الحجز».
 *
 * ## What the integration test cannot see
 *
 * `arrivals.integration.test.ts` holds the rules: the partner scope in the `WHERE`, a malformed
 * reference answering as a miss, and a booking outside today's window still being findable. All of
 * that was true of a service nobody could reach — the screen had no search at all, while its own
 * intro had been promising «ابحث بالاسم أو برقم الحجز» for months. A capability with no control in
 * front of it is the defect class this file exists for, and only a browser can see it.
 *
 * ## Both answers, in one session
 *
 * A miss and a hit are asserted against the SAME screen, because the interesting failure is a page
 * that renders «تعذّر البحث» for both — which is what a lookup built on the ordinary fetch helper
 * would have done, since that folds 404 into `failed`.
 */
test.use({ storageState: PARTNER_STATE, baseURL: BASE });

test.describe('البحث برقم الحجز', () => {
  test('finds a booking by its reference, and says so plainly when there is none', async ({
    page,
  }) => {
    await page.goto('/arrivals');

    const form = page.locator('form:has(input[name="reference"])');

    await expect(form, 'the search the intro promises actually exists').toBeVisible();

    /*
      A reference this partner really owns, taken from the day's list.

      Typed in by hand it would be a fixture constant that goes stale the next time the testbed is
      reseeded; read off the screen it is always a live one.
    */
    const rows = page.locator('#arrivals-list li');
    const count = await rows.count();

    test.skip(count === 0, 'No arrivals today to look up.');

    const reference = /BKG-\d{4}-\d+/.exec(await rows.first().innerText())?.[0] ?? '';

    expect(reference, 'a reference on the day’s list').not.toBe('');

    // ── The hit ──────────────────────────────────────────────────────────────
    await form.locator('input[name="reference"]').fill(reference);
    await form.locator('button[type="submit"]').click();
    await page.waitForURL(/reference=/, { timeout: 20_000 });

    await expect(page.getByText(t.arrivals.lookup.result)).toBeVisible();
    await expect(page.getByText(reference, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(t.arrivals.lookup.notFound)).toHaveCount(0);

    /* The URL carries it, so the desk can reload or hand the tab to a colleague. */
    expect(page.url()).toContain(encodeURIComponent(reference));

    // ── The miss ─────────────────────────────────────────────────────────────
    /*
      A reference shaped exactly like a real one, so what is being proved is the SCOPE and not the
      pattern check. `BKG-1999-000001` predates the platform, so no reseed can make it exist.
    */
    await page.goto('/arrivals?reference=BKG-1999-000001');

    await expect(page.getByText(t.arrivals.lookup.notFound)).toBeVisible();
    /* And NOT the outage sentence — the distinction this lookup has its own fetch helper for. */
    await expect(page.getByText(t.arrivals.lookup.failed)).toHaveCount(0);
    await expect(page.locator('#arrivals-list')).toHaveCount(0);

    // ── Rubbish answers exactly as a miss ────────────────────────────────────
    await page.goto('/arrivals?reference=%2Fetc%2Fpasswd');

    await expect(page.getByText(t.arrivals.lookup.notFound)).toBeVisible();

    // ── And the way back ─────────────────────────────────────────────────────
    await page.getByRole('link', { name: t.arrivals.lookup.clear }).click();
    await page.waitForURL(/\/arrivals$/, { timeout: 20_000 });

    await expect(page.locator('#arrivals-list')).toBeVisible();
  });

  /** The desk is a phone as often as a screen; a control below the fold is not a control. */
  test('is usable at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto('/arrivals');

    const field = page.locator('input[name="reference"]');

    await expect(field).toBeVisible();

    const box = (await field.boundingBox())!;

    expect(box.height, 'a finger-sized control').toBeGreaterThanOrEqual(40);

    /* No page scrolls sideways — the standing rule, asserted where a new form was added. */
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow, 'no horizontal page scroll').toBeLessThanOrEqual(0);
  });
});
