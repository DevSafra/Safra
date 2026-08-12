import { expect, test } from '@playwright/test';

import { partnerAr as t } from '../packages/i18n/src/partner.js';
import { PARTNER_BASE as BASE, PARTNER_STATE } from './partner-session.js';

/**
 * الدعم, partner side (Bashar, 2026-08-12).
 *
 * ## What a browser adds
 *
 * `support.integration.test.ts` proves the scoping, the redaction and the refusals against a real
 * database. What it cannot see is whether the SCREEN works — and the support pages are a form, a proxy
 * and two server components deep, where a failure renders as an empty page with a 200.
 *
 * ## It costs no sign-in
 *
 * The partner project replays the session `partner.setup.ts` captured, so this spec adds nothing to the
 * login budget that shapes the rest of the suite — unlike the customer side, whose support assertions
 * ride along inside `customer-gifts.spec.ts` for exactly that reason.
 *
 * ## It leaves a ticket behind, deliberately
 *
 * Messages are append-only by trigger, so a spec cannot tidy up after itself here. It opens a real ticket
 * every run, which is the only way to keep testing the OPEN path — a spec that reused an existing thread
 * would stop exercising it after the first run. `db:testbed` clears them, which is what bounds the count.
 */
test.use({ baseURL: BASE, storageState: PARTNER_STATE });

const ENOUGH = 'مستحقاتي لم تُحدَّث هذا الشهر ولم يردّ أحد على رسالتي.';

test.describe('الدعم', () => {
  test('opens a request, masks a phone number, and replies', async ({ page }) => {
    await page.goto('/support');

    /* The destination exists in the sidebar, not only as a URL. */
    await expect(
      page.getByRole('link', { name: t.nav.supportPage, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: t.support.openTitle })).toBeVisible();

    /*
      A phone number goes in on purpose. Contact details are redacted on the way IN and the original is
      never kept, so this is the assertion that the rule reaches the screen a partner actually uses.
    */
    await page.locator('textarea[name=body]').fill(`${ENOUGH} اتصلوا بي على 0955123456.`);

    /*
      `form:has(textarea)`, not the last submit on the page.

      The sidebar's sign-out is itself a form submit button, so a looser selector signs the partner out —
      after which the reply does nothing and every later assertion fails for an unrelated reason. That
      cost a debugging cycle when this was first written.
    */
    await page.locator('form:has(textarea) button[type=submit]').click();
    await page.waitForURL(/\/support\/CNV-/, { timeout: 20_000 });

    const thread = page.locator('ol');

    await expect(thread).not.toContainText('0955123456');
    /* And the masking is announced, or the sender waits for a call that cannot come. */
    await expect(thread).toContainText('حُجبت');

    // ── A reply lands in the same thread ──
    const before = await page.locator('ol li').count();

    await page.locator('textarea[name=body]').fill('هل من تحديث بشأن هذا الطلب؟');
    await page.locator('form:has(textarea) button[type=submit]').click();

    await expect(page.locator('ol li')).toHaveCount(before + 1, { timeout: 20_000 });

    // ── It is listed ──
    await page.goto('/support');
    await expect(page.locator('a[href^="/support/CNV-"]').first()).toBeVisible();

    /*
      A reference that is not this partner's is a 404, indistinguishable from one that does not exist.
      `CNV-` references are sequential, so any difference would let one partner count another's requests.
    */
    const foreign = await page.goto('/support/CNV-000001', {
      waitUntil: 'domcontentloaded',
    });

    expect(foreign?.status()).toBe(404);

    // ── No page scrolls sideways ──
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/support', { waitUntil: 'domcontentloaded' });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(overflow, `/support scrolls sideways at ${width}px`).toBeLessThanOrEqual(0);
    }
  });
});
