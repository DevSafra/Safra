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
  Long enough for a full throttle window, because this project runs immediately after
  `staff-login.spec.ts` has spent eight of the ten sign-ins the limiter allows per minute.

  A wait in a test suite is normally a smell. This one is load-bearing and cheap to justify: the
  alternative is a suite that fails intermittently with «محاولات كثيرة» — a message about the
  limiter doing its job, attached to whichever test happened to run when the budget ran out. That
  failure has already cost this project two debugging sessions.
*/
const THROTTLE_WINDOW_MS = 61_000;

setup('capture a partner session', async ({ page, context }) => {
  setup.setTimeout(THROTTLE_WINDOW_MS + 30_000);
  await new Promise((resolve) => setTimeout(resolve, THROTTLE_WINDOW_MS));

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
