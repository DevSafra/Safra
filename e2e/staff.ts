import { authenticator } from 'otplib';
import { expect, type Page } from '@playwright/test';

import { AR } from '../apps/admin/src/lib/strings.js';

/**
 * Shared plumbing for the staff-console browser tests.
 *
 * Extracted so the auth setup project and the spec can use the same sign-in. Not named
 * `*.spec.ts` on purpose — Playwright's default `testMatch` would try to run it as a suite.
 */

/**
 * Credentials come from the environment, never from a file in the repository.
 *
 * They are only local test accounts, but a password committed to a repository is a password
 * in git history forever — and the one thing worse than a weak test credential is one that
 * gets reused somewhere real. `pnpm e2e` sources the git-ignored `.env`, which is where
 * these live.
 */
export const EMAIL = process.env['DEV_STAFF_EMAIL'];
export const PASSWORD = process.env['DEV_STAFF_PASSWORD'];
export const SECRET = process.env['DEV_OPS_TOTP_SECRET'];

/** Every staff test needs all three; without them the suite skips rather than fails. */
export const MISSING_CREDENTIALS = !EMAIL || !PASSWORD || !SECRET;

export const SKIP_REASON =
  'Staff test credentials are not set — run via `pnpm e2e`, which sources .env';

/**
 * The captured session, written by the setup project and replayed by the tests behind it.
 *
 * `POST /auth/login` is throttled to five calls a minute per IP (rule 1) and a two-step
 * sign-in spends two of them. Signing in per test does not merely waste time — it trips the
 * limiter partway through the run and every later test then fails with "too many attempts",
 * which looks exactly like a broken login form. That happened while these tests were being
 * written, and cost an hour of chasing a defect that was the rate limiter doing its job.
 *
 * Lives under `test-results/`, which is git-ignored: the file holds a live session cookie.
 */
export const STAFF_STATE = 'test-results/.staff-session.json';

/**
 * Fields are located by ROLE, not by label text.
 *
 * `getByLabel` matches a label's raw `textContent`, so it sees "Password *" — the
 * decorative asterisk the customer app appends — and it also matches the "Show password"
 * toggle by substring. Role-name computation respects `aria-hidden` and cannot collide with
 * a button, so it resolves to exactly the input in both apps.
 */
export const field = (page: Page, name: string) =>
  page.getByRole('textbox', { name, exact: true });

/**
 * The submit button, located by its TYPE rather than its label.
 *
 * Button wording is copy and changes freely — "Continue" became "Sign in" and "Verify and
 * sign in" became "Verify code" while these tests were being written, and matching on text
 * made the whole suite fail for a reason that had nothing to do with behaviour. There is
 * exactly one submit button per step, so type is both stable and unambiguous.
 */
export const submit = (page: Page) => page.locator('button[type="submit"]');

/**
 * A code with only a moment left will expire between generation and submission, so wait for
 * the next window rather than produce a flake that looks like a broken form.
 */
export async function freshCode(): Promise<string> {
  if (authenticator.timeRemaining() < 5) {
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }

  return authenticator.generate(SECRET as string);
}

/** Both steps of the sign-in, ending on the dashboard. */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await field(page, AR.login.email).fill(EMAIL as string);
  await field(page, AR.login.password).fill(PASSWORD as string);
  await submit(page).click();

  await field(page, AR.login.code).fill(await freshCode());
  await submit(page).click();

  await expect(page.getByRole('heading', { name: AR.admin.title })).toBeVisible();
}
