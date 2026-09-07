import { expect, type Page } from '@playwright/test';

/**
 * Making the payouts a spec needs, through the control a person would press.
 *
 * ## Why this exists
 *
 * `pnpm db:testbed` seeds bookings and creates NO payouts: those come from the hourly
 * `payout-accrual` job (`0 * * * *`) reading completed ones. So on a freshly reset testbed every
 * payout workflow was unverifiable — `payout-accounts.spec.ts` and `dispute-payout-freeze.spec.ts`
 * both failed with messages saying exactly that, and neither could do anything about it. Waiting up
 * to an hour is not an option for a suite, and the API's own `POST /admin/payouts/accrue` refuses a
 * browser session with 401 because a session cookie is not an access token.
 *
 * The console grew the control on 2026-09-07 (Bashar: «I do not want operational workflows that
 * require direct API calls when they should reasonably be available through the Super Admin
 * Console»), so a spec can now provision the same way an operator does.
 *
 * ## Through the UI deliberately, not around it
 *
 * A helper that reached into the database would provision faster and prove less. Pressing the
 * control exercises the permission, the confirmation and the BFF route on the way — so a spec that
 * needs a payout also witnesses that the surface making payouts exists and works, which is the
 * thing that was missing in the first place.
 *
 * ## Idempotent, so calling it costs nothing
 *
 * Accrual attaches only bookings that are not already on a payout, so a second call attaches zero
 * and changes nothing. Specs may call it without coordinating.
 */
/*
  `base` is the console's origin, and defaults to EMPTY so a spec whose `baseURL` is already the
  console can navigate relatively. Specs that drive two applications in one file carry their own
  absolute constant instead.
*/
export async function accrueThroughConsole(page: Page, base = ''): Promise<void> {
  await page.goto(`${base}/payouts`, { waitUntil: 'domcontentloaded' });

  const control = page.getByRole('button', { name: 'تجميع المستحقات الآن' });

  await expect(
    control,
    'the console offers a way to run accrual — if this is gone, the payout specs cannot provision',
  ).toBeVisible({ timeout: 20_000 });

  await control.click();

  const dialog = page.locator('[role=alertdialog]');

  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'تجميع', exact: true }).click();

  /*
    The outcome line, not a timeout. It is what tells an operator the sweep finished, so waiting
    for it is waiting for the same fact rather than for a duration that happens to be long enough.
  */
  await expect(page.getByText('تمّ التجميع', { exact: false })).toBeVisible({
    timeout: 30_000,
  });
}
