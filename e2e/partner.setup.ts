import { authenticator } from 'otplib';
import { test as setup } from '@playwright/test';

import { partnerAr as t } from '../packages/i18n/src/partner.js';

/**
 * Signs in one enrolled partner and saves the session for the tests behind it.
 *
 * The same device `auth.setup.ts` uses for staff, and for the same reason — but partner 2FA made
 * it necessary rather than merely tidy. `POST /auth/login` allows ten calls a minute per IP, a
 * two-step sign-in spends two, and the staff specs already spend most of the rest. With the
 * partner specs signing in three times the last staff test tipped over the limit and failed as
 * «محاولات كثيرة», which is a message about the suite rather than about the product.
 *
 * A SETUP project rather than a hook: Playwright restarts the worker after a failing test and
 * re-runs file-scoped hooks in the new one, so a hook-based sign-in gets throttled on the retry
 * and turns one real failure into a whole-suite cascade.
 *
 * The sign-in JOURNEY still has its own tests — the two-step form and the forced-enrolment gate
 * are asserted in `partner.spec.ts`, which signs in for real — so this shortcut cannot hide a
 * broken login.
 */
import {
  PARTNER_BASE as BASE,
  PARTNER_EMAIL as EMAIL,
  PARTNER_PASSWORD as PASSWORD,
  PARTNER_STATE,
  PARTNER_TOTP_SECRET as SECRET,
} from './partner-session.js';

/*
  The sixty-second wait that used to be here is GONE, and that is the point of the change on
  2026-08-07.

  Auth throttling was keyed on IP alone, so this suite's fourteen sign-ins — eight of them in
  `staff-login.spec.ts`, which tests the form itself — shared one ten-a-minute budget and the last
  ones failed as «محاولات كثيرة». The fix was not a bigger budget: it was keying the limit on IP +
  ACCOUNT, so `ops@safra.test`, `partner1`, `partner3` and `customer@safra.test` each have their
  own. The suite stopped competing with itself for the same reason a NAT'd office of partners
  stopped competing with each other.

  The projects still run in order — see `playwright.config.ts` — because staff and partner specs
  share a database, not a rate limit.
*/
setup('capture a partner session', async ({ page, context }) => {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(t.login.email).fill(EMAIL);
  await page.getByLabel(t.login.password, { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: t.login.submit }).click();

  /* A code with only a moment left would expire between generation and submission. */
  if (authenticator.timeRemaining() < 5) {
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }

  await page.getByLabel(t.login.codeLabel).fill(authenticator.generate(SECRET));
  await page.getByRole('button', { name: t.login.codeSubmit }).click();

  await page.waitForURL(`${BASE}/`);
  await context.storageState({ path: PARTNER_STATE });
});
