import { expect, test, type Browser } from '@playwright/test';

import { PARTNER_BASE, PARTNER_STATE } from './partner-session.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * The listing lifecycle, across two applications: partner submits, SAFRA reviews.
 *
 * ## Why this spec exists
 *
 * On 2026-09-04 the platform held **627 drafts, 61 rejected listings and zero in `pending_review`**
 * — because a partner had no way to submit one. `POST /partner/properties/:reference/submit` had
 * its permission, its ownership check, its unit guard, its audit row and its timeline event, and
 * no caller anywhere in the portal. Neither did `POST .../units`, so a listing that arrived without
 * a unit could never gain one: **991 properties were in that state, 468 of them published.**
 *
 * Every suite was green throughout. Nothing was broken — a step simply did not exist, and no test
 * that checks whether a screen works can notice a screen that was never built. What catches this
 * class is a test of the JOURNEY, which is why this one crosses the application boundary rather
 * than asserting on either side of it.
 *
 * ## It completes the loop rather than leaving a fixture consumed
 *
 * The partner submits and the console REJECTS, which returns the listing to `rejected` — a state
 * that is submittable again. So the spec is repeatable by construction rather than by cleanup, and
 * the rejection is itself worth asserting: it is how a partner learns what to fix, and the reason
 * for it has to reach them.
 *
 * Deliberately NOT approve: publishing changes the fixture permanently and would put an unreviewed
 * test listing into the customer site's search results.
 */
const DRAFT = 'PRO-363249';

test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.describe.configure({ mode: 'serial' });

test.use({
  baseURL: PARTNER_BASE,
  storageState: PARTNER_STATE,
  viewport: { width: 1440, height: 900 },
});

/**
 * Rejects the listing from the console, with a reason, and returns it to a submittable state.
 *
 * Used twice: once to NORMALISE — a previous run, or a person clicking through, leaves the listing
 * in `pending_review`, and a spec that assumed `draft` would measure the leftover instead of the
 * change — and once at the end to complete the loop. A fixture put back by construction beats one
 * put back by cleanup, which is skipped exactly when a test fails.
 */
async function rejectFromConsole(browser: Browser, reason: string): Promise<boolean> {
  const staff = await browser.newContext({ storageState: STAFF_STATE });
  const consolePage = await staff.newPage();

  try {
    await consolePage.goto(`http://localhost:3001/properties/${DRAFT}`, {
      waitUntil: 'domcontentloaded',
    });

    const reject = consolePage.getByRole('button', { name: 'رفض العقار' });

    if ((await reject.count()) === 0) return false;

    const decided = consolePage.waitForResponse(
      (r) => r.url().includes('/review') && r.request().method() === 'POST',
    );

    await reject.first().click();
    await consolePage.locator('#property-notes').fill(reason);
    await consolePage.getByRole('button', { name: 'تأكيد الرفض' }).click();

    expect((await decided).status(), 'the console recorded the decision').toBeLessThan(
      400,
    );

    return true;
  } finally {
    await staff.close();
  }
}

test('a partner submits a listing and SAFRA reviews it', async ({ page, browser }) => {
  /* Whatever the last run left behind, start from a listing this partner may submit. */
  await rejectFromConsole(browser, 'إعادة ضبط التجربة الآلية');

  await page.goto(`/properties/${DRAFT}/edit`, { waitUntil: 'domcontentloaded' });

  const card = page.locator(`[data-submit-review="${DRAFT}"]`);

  await expect(card, 'the submit step is on the screen at all').toBeVisible();

  /*
    A listing with no unit cannot be reviewed — the API refuses it with `property.unit_required`.
    The screen has to say so BEFORE the partner presses anything, and the button stays visible and
    disabled rather than hidden, so the reader learns the step exists and what is blocking it.
  */
  const units = page.locator('[data-unit]');
  const unitCount = await units.count();
  const submit = page.getByRole('button', { name: 'أرسل للمراجعة' });

  if (unitCount === 0) {
    await expect(submit, 'refused, and visibly so, without a unit').toBeDisabled();
    await expect(page.getByText('أضف وحدة واحدة على الأقل')).toBeVisible();

    await page.locator(`[data-add-unit="${DRAFT}"]`).click();
    await page.getByLabel('اسم الوحدة').last().fill('وحدة');
    await page.getByLabel('السعر الأساسي لليلة').last().fill('120');
    await page.getByRole('button', { name: 'أضف الوحدة' }).click();
    await expect(page.getByText('أُضيفت الوحدة.')).toBeVisible({ timeout: 15_000 });
    await page.goto(`/properties/${DRAFT}/edit`, { waitUntil: 'domcontentloaded' });
  }

  // ── The partner submits ──
  const submitted = page.waitForResponse(
    (r) => r.url().includes('/submit') && r.request().method() === 'POST',
  );

  await page.getByRole('button', { name: 'أرسل للمراجعة' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'تأكيد' }).click();

  /* 201: NestJS answers a POST that way, and the proxy passes the status through. */
  expect((await submitted).status(), 'the API accepted the submission').toBe(201);
  await expect(page.getByText('أُرسل العقار للمراجعة.')).toBeVisible({ timeout: 15_000 });

  /* The state is visible on reload, and the screen explains why there is no button now. */
  await page.goto(`/properties/${DRAFT}/edit`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`[data-submit-review="${DRAFT}"]`)).toContainText(
    'قيد المراجعة',
  );
  await expect(
    page.getByRole('button', { name: 'أرسل للمراجعة' }),
    'and no second submit is offered',
  ).toHaveCount(0);

  // ── SAFRA sees it, in the other application, and decides ──
  const reason = `مراجعة آلية ${Date.now()}`;

  expect(
    await rejectFromConsole(browser, reason),
    'the console offers a decision on the listing the partner just submitted',
  ).toBe(true);

  /* The reason reaches the partner's own screen — the half that makes a rejection useful. */
  await page.goto(`/properties/${DRAFT}/edit`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main')).toContainText(reason);
  await expect(
    page.getByRole('button', { name: 'أرسل للمراجعة' }),
    'and a rejected listing can be submitted again',
  ).toBeVisible();
});
