import type { Page } from '@playwright/test';

import { acceptConfirm } from './confirm.js';

/**
 * The account a test transfer comes from (2026-10-02). Any refund of it must go back here.
 *
 * Typed with spaces, the way a person copies an IBAN off a statement; the API normalises it.
 */
export const TEST_PAYER_ACCOUNT = 'SY12 0000 0000 0000 0000 1234';

/**
 * «تأكيد استلام الحوالة» as finance does it: open the control, enter the account the transfer came
 * from, continue, and confirm. One helper, because four journeys drive it, and a step added to the
 * control has to reach all four rather than the one somebody remembers.
 */
export async function confirmTransferReceived(
  page: Page,
  payerAccount: string = TEST_PAYER_ACCOUNT,
): Promise<void> {
  await page.getByRole('button', { name: 'تأكيد استلام الحوالة', exact: true }).click();
  await page.getByLabel('الحساب الذي وصلت منه الحوالة').fill(payerAccount);
  await page.getByRole('button', { name: 'متابعة', exact: true }).click();
  await acceptConfirm(page);
}
