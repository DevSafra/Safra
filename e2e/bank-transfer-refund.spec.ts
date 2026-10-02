import { expect, test } from '@playwright/test';

import { acceptConfirm } from './confirm.js';
import { STAFF_STATE } from './staff.js';
import { confirmTransferReceived } from './transfer.js';

/**
 * A bank-transfer refund goes back to the account the money came from, in the console a person
 * actually uses (Bashar, 2026-10-02: «build the bank transfer fix»).
 *
 * Driven end to end: a booking, the transfer confirmed WITH its sender's account, a refund, and the
 * settlement twice. Once to another account, which must be refused on screen and leave the refund
 * waiting, and once back to the sender's account, typed the way a person copies it, with Arabic
 * digits and spaces, which must complete and say where it went. The API's and the database's halves
 * are held by `refund-destination.integration.test.ts`; this is what an operator meets.
 */
const API = 'http://localhost:4000/api/v1';

function isoDate(daysAhead: number): string {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() + daysAhead);
  return at.toISOString().slice(0, 10);
}

test.use({ storageState: STAFF_STATE });

test('a bank-transfer refund is settled only back to the account it came from', async ({
  page,
  request,
}) => {
  const checkIn = isoDate(240 + (Date.now() % 60));
  const checkOut = isoDate(242 + (Date.now() % 60));
  const search = await request.get(
    `${API}/search?checkIn=${checkIn}&checkOut=${checkOut}&adults=2&limit=1`,
  );
  const unitId = (await search.json()).items?.[0]?.unitId as string | undefined;

  expect(unitId, 'the testbed holds a bookable unit').toBeTruthy();

  const stamp = Date.now();
  const created = await request.post(`${API}/bookings`, {
    data: {
      unitId,
      checkIn,
      checkOut,
      adults: 2,
      guest: {
        fullName: 'Refund Account Guest',
        email: `refund-acct-${stamp}@safra.test`,
        phone: '+963900000124',
      },
      idempotencyKey: `refund-acct-${stamp}-0000`,
    },
  });

  expect(created.status(), await created.text()).toBe(201);
  const booking = (await created.json()) as { reference: string; accessToken: string };
  const reference = booking.reference;

  /* The customer starts paying, which routes to the bank transfer: the only rail operated today. */
  const started = await request.post(`${API}/payments/start`, {
    data: { reference, accessToken: booking.accessToken },
  });
  expect(started.ok(), await started.text()).toBe(true);

  await page.goto(`/bookings/${reference}`);
  await confirmTransferReceived(page, 'SY12 0000 0000 0000 0000 1234');
  await expect(page.locator('[data-status-pill]').first()).toHaveText('قيد التأكيد', {
    timeout: 20_000,
  });

  /* The refund, through the console's own form. */
  await page.getByRole('button', { name: 'استرداد', exact: true }).click();
  const refundForm = page
    .locator('form')
    .filter({ has: page.getByLabel('سبب الاسترداد') });
  await refundForm.getByLabel('سبب الاسترداد').fill('الشريك لم يعد يستطيع استقبال الضيف');
  await refundForm.getByRole('button').last().click();

  const settle = page.getByRole('button', { name: 'تأكيد إرسال الاسترداد', exact: true });
  await expect(settle, 'a bank-transfer refund waits for finance').toBeVisible({
    timeout: 20_000,
  });
  await settle.click();

  await expect(
    page.getByText('يُعاد المبلغ إلى الحساب الذي وصلت منه الحوالة، المنتهي بـ'),
  ).toBeVisible();

  /* Somebody else's account: refused, and the refund is still waiting. */
  await page
    .getByLabel('الحساب الذي أُرسل إليه الاسترداد')
    .fill('SY99 9999 9999 9999 9999 9999');
  await page.getByLabel('مرجع الحوالة الصادرة').fill('TRX-WRONG-1');
  await page.getByRole('button', { name: 'متابعة', exact: true }).click();
  await acceptConfirm(page);

  await expect(
    page.getByRole('alert').filter({ hasText: 'ليس الحساب الذي وصلت منه الحوالة' }),
  ).toBeVisible();
  await expect(settle, 'still waiting after the refusal').toBeVisible();

  /* The sender's own account, typed with Arabic digits and spaces: settled, and the record says where. */
  await page
    .getByLabel('الحساب الذي أُرسل إليه الاسترداد')
    .fill('sy12 ٠٠٠٠ ٠٠٠٠ ٠٠٠٠ ٠٠٠٠ ١٢٣٤');
  await page.getByLabel('مرجع الحوالة الصادرة').fill('TRX-RIGHT-1');
  await page.getByRole('button', { name: 'متابعة', exact: true }).click();
  await acceptConfirm(page);

  await expect(
    page.getByText(/أُرسل إلى الحساب المنتهي بـ .*1234.* · المرجع .*TRX-RIGHT-1/),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(settle, 'nothing left to settle').toHaveCount(0);
});
