import { expect, test } from '@playwright/test';

import { PARTNER_BASE, PARTNER_STATE } from './partner-session.js';
import { MISSING_CREDENTIALS, SKIP_REASON } from './staff.js';

/**
 * الإعدادات — where money arrives and the password that protects it (Bashar, 2026-09-04).
 *
 * ## What is driven here, and what is not
 *
 * The REFUSAL path for the password, not the success one. A successful change revokes every
 * refresh family including this suite's, so a spec that drove it would sign itself out and force a
 * fresh sign-in — against a login budget of ten a minute per (IP, account) that this suite already
 * spends fourteen of. The success path is held by `customer-account.integration.test.ts`, which
 * verifies the digest, the session revocation and both audit rows.
 *
 * What a refusal proves is the whole wiring: the form posts, the route handler validates and
 * proxies, the API verifies the current password against Argon2id and refuses, and the sentence
 * that comes back is Arabic rather than a raw code. That is the part no unit test can see.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.use({
  baseURL: PARTNER_BASE,
  storageState: PARTNER_STATE,
  viewport: { width: 1440, height: 900 },
});

test('holds both the payout destination and the password', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });

  const main = page.locator('main');

  await expect(main).toContainText('حسابات التحويل');
  await expect(main).toContainText('كلمة المرور');

  /* The consequence, stated before the fields rather than discovered after the button. */
  await expect(main, 'the session warning is on the screen').toContainText(
    'ينهي كل الجلسات الأخرى',
  );

  /* Three password inputs, every one with the eye — the house rule. */
  const eyes = page.locator('[data-change-password] button[aria-label]');

  await expect(eyes).toHaveCount(3);
});

test('the old حسابات التحويل link still lands somewhere useful', async ({ page }) => {
  await page.goto('/payouts/accounts', { waitUntil: 'domcontentloaded' });

  expect(page.url()).toContain('/settings');
  await expect(page.locator('main')).toContainText('حسابات التحويل');
});

test('a wrong current password is refused in Arabic, not with a code', async ({
  page,
}) => {
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });

  const form = page.locator('[data-change-password]');

  await form.getByLabel('كلمة المرور الحالية').fill('definitely-not-the-password-1A!');
  await form.getByLabel('كلمة المرور الجديدة', { exact: true }).fill('A-new-Password-1!');
  await form.getByLabel('تأكيد كلمة المرور الجديدة').fill('A-new-Password-1!');

  const answered = page.waitForResponse(
    (r) => r.url().includes('/api/auth/password') && r.request().method() === 'POST',
  );

  await form.getByRole('button', { name: 'تغيير كلمة المرور' }).click();

  expect((await answered).status(), 'a wrong password is a 400, never a 401').toBe(400);

  /*
    Scoped to the FORM. Next renders a `__next-route-announcer__` with `role="alert"` on every
    page, so an unscoped `getByRole('alert')` matches two elements and fails on strictness — which
    reads as the message being absent when it is present.
  */
  const alert = form.getByRole('alert');

  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(
    alert,
    'the reader is told what is wrong, in their language',
  ).toContainText('كلمة المرور الحالية غير صحيحة');
});

/**
 * A mismatch is caught HERE, without spending one of five attempts a minute.
 *
 * The throttle on `/auth/me/password` exists to stop somebody guessing at a borrowed screen, and a
 * typo in the confirmation field is not a guess. Asserting that no request is made is the point —
 * the message alone would also appear if the round trip had happened and been refused.
 */
test('a mismatched confirmation never reaches the API', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });

  let posted = false;

  page.on('request', (request) => {
    if (request.url().includes('/api/auth/password')) posted = true;
  });

  const form = page.locator('[data-change-password]');

  await form.getByLabel('كلمة المرور الحالية').fill('whatever-1A!');
  await form.getByLabel('كلمة المرور الجديدة', { exact: true }).fill('A-new-Password-1!');
  await form.getByLabel('تأكيد كلمة المرور الجديدة').fill('A-different-Password-1!');
  await form.getByRole('button', { name: 'تغيير كلمة المرور' }).click();

  await expect(form.getByRole('alert')).toContainText('غير متطابقتين');
  expect(posted, 'no request was made').toBe(false);
});

/**
 * The portal points at الدعم, never at an address.
 *
 * `partners@safra.com` was removed from the sidebar on 2026-08-14 for a stated reason — الدعم is a
 * SCREEN that opens a tracked thread, and an email beside it offers a second, worse route with no
 * reference, no status and no record on the partner's account. It survived on مستحقاتي until
 * Bashar found it on 2026-09-05. A rule applied to one surface and not swept is a rule that comes
 * back, so this looks at the whole page rather than at the sentence it was found in.
 */
test('names الدعم rather than an email address', async ({ page }) => {
  await page.goto('/payouts', { waitUntil: 'domcontentloaded' });

  const text = await page.locator('main').innerText();

  expect(text).toContain('راسل الدعم');
  expect(text, 'no address anywhere on the screen').not.toContain('@safra.com');
});

/**
 * مستحقاتي answers «how much, and when» — the two questions it used to answer neither of.
 *
 * The grouping assertion is the one that matters: the portal shipped with a hand-written set of
 * five payout statuses, none of which exists in the enum, so every open payout was filed under
 * «مكتملة» and the summary read «لا مستحقات قيد التحويل» above money that was owed.
 */
test('مستحقاتي states what is owed and files it under the right heading', async ({
  page,
}) => {
  await page.goto('/payouts', { waitUntil: 'domcontentloaded' });

  const main = page.locator('main');
  const text = await main.innerText();

  console.log('--- مستحقاتي ---\n' + text.slice(0, 700));

  /* A summary sentence either way — an amount awaiting transfer, or that there is none. */
  expect(
    /قيد التحويل|لا مستحقات قيد التحويل/.test(text),
    'the screen answers «how much is coming»',
  ).toBe(true);

  /*
    Whatever the fixture holds, no payout may sit under a heading that contradicts its own pill.
    «بانتظار الإفراج» under «مكتملة» is the defect this replaces, and it is visible in the text.
  */
  const settledIndex = text.indexOf('مكتملة');

  if (settledIndex >= 0) {
    expect(
      text.slice(settledIndex).includes('بانتظار الإفراج'),
      'nothing awaiting release is filed as completed',
    ).toBe(false);
  }
});
