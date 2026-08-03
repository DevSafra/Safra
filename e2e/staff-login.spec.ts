import { authenticator } from 'otplib';
import { expect, test, type Page } from '@playwright/test';

/**
 * The staff sign-in flow, driven through a real browser.
 *
 * Every assertion here corresponds to a defect that shipped and that the 554 unit and
 * integration tests could not see, because all of them are HTTP-level and these pages
 * return `200` with correct server-rendered HTML even when the client is completely
 * broken:
 *
 * - a CSP that blocked every hydration script, so no form submitted at all;
 * - a recycled DOM node that delivered the password into the code field;
 * - `defaultValue` on a reused input, so going back left the email box empty.
 *
 * Credentials come from `.env`, which is git-ignored and holds the local test accounts.
 */
/**
 * Credentials come from the environment, never from this file.
 *
 * They are only local test accounts, but a password committed to a repository is a
 * password in git history forever — and the one thing worse than a weak test credential
 * is one that gets reused somewhere real. `pnpm e2e` sources the git-ignored `.env`,
 * which is where these live.
 */
const EMAIL = process.env['DEV_STAFF_EMAIL'];
const PASSWORD = process.env['DEV_STAFF_PASSWORD'];
const SECRET = process.env['DEV_OPS_TOTP_SECRET'];

/**
 * Fields are located by ROLE, not by label text.
 *
 * `getByLabel` matches a label's raw `textContent`, so it sees "Password *" — the
 * decorative asterisk the customer app appends — and it also matches the "Show password"
 * toggle by substring. Role-name computation respects `aria-hidden` and cannot collide
 * with a button, so it resolves to exactly the input in both apps.
 */
const field = (page: Page, name: string) =>
  page.getByRole('textbox', { name, exact: true });

/**
 * The submit button, located by its TYPE rather than its label.
 *
 * Button wording is copy and changes freely — "Continue" became "Sign in" and "Verify
 * and sign in" became "Verify code" while these tests were being written, and matching
 * on text made the whole suite fail for a reason that had nothing to do with behaviour.
 * There is exactly one submit button per step, so type is both stable and unambiguous.
 */
const submit = (page: Page) => page.locator('button[type="submit"]');

test.skip(
  !EMAIL || !PASSWORD || !SECRET,
  'Staff test credentials are not set — run via `pnpm e2e`, which sources .env',
);

/**
 * A code with only a moment left will expire between generation and submission, so wait
 * for the next window rather than produce a flake that looks like a broken form.
 */
async function freshCode(): Promise<string> {
  if (authenticator.timeRemaining() < 5) {
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }

  return authenticator.generate(SECRET as string);
}

test.describe('staff sign-in', () => {
  test('hydrates at all — the form responds to input', async ({ page }) => {
    /**
     * THE canary. A blocked script leaves the markup perfect and the page inert, so this
     * asserts something only a live client can do: React re-rendering a controlled input
     * as it is typed.
     */
    const violations: string[] = [];
    page.on('console', (message) => {
      if (/content security policy|refused to execute/i.test(message.text())) {
        violations.push(message.text());
      }
    });

    await page.goto('/login');
    await field(page, 'Email').fill(EMAIL as string);

    await expect(field(page, 'Email')).toHaveValue(EMAIL as string);
    expect(violations, 'CSP violations in the console').toEqual([]);
  });

  test('asks for the code only after the password is accepted', async ({ page }) => {
    await page.goto('/login');

    // Step one shows no code field at all.
    await expect(field(page, 'Authenticator code')).toBeHidden();

    await field(page, 'Email').fill(EMAIL as string);
    await field(page, 'Password').fill(PASSWORD as string);
    await submit(page).click();

    await expect(field(page, 'Authenticator code')).toBeVisible();
    await expect(
      page.getByText(
        "Enter the code from your two-factor authenticator app. If you've lost your device, you can enter one of your recovery codes.",
      ),
    ).toBeVisible();
  });

  /** The reported defect: the code box arrived holding the password. */
  test('the code field is empty when it appears', async ({ page }) => {
    await page.goto('/login');
    await field(page, 'Email').fill(EMAIL as string);
    await field(page, 'Password').fill(PASSWORD as string);
    await submit(page).click();

    const code = field(page, 'Authenticator code');
    await expect(code).toBeVisible();
    await expect(code).toHaveValue('');
  });

  /** The other reported defect: going back cleared the email. */
  test('going back keeps the email and password filled', async ({ page }) => {
    await page.goto('/login');
    await field(page, 'Email').fill(EMAIL as string);
    await field(page, 'Password').fill(PASSWORD as string);
    await submit(page).click();

    await page.getByRole('button', { name: 'Use a different account' }).click();

    await expect(field(page, 'Email')).toHaveValue(EMAIL as string);
    await expect(field(page, 'Password')).toHaveValue(PASSWORD as string);
  });

  test('returning to the code step clears a previously typed code', async ({ page }) => {
    await page.goto('/login');
    await field(page, 'Email').fill(EMAIL as string);
    await field(page, 'Password').fill(PASSWORD as string);
    await submit(page).click();

    await field(page, 'Authenticator code').fill('123456');
    await page.getByRole('button', { name: 'Use a different account' }).click();
    await submit(page).click();

    await expect(field(page, 'Authenticator code')).toHaveValue('');
  });

  test('signs in with a valid code and reaches the dashboard', async ({ page }) => {
    await page.goto('/login');
    await field(page, 'Email').fill(EMAIL as string);
    await field(page, 'Password').fill(PASSWORD as string);
    await submit(page).click();

    await field(page, 'Authenticator code').fill(await freshCode());
    await submit(page).click();

    await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();
  });

  test('a wrong password never reaches the code step', async ({ page }) => {
    await page.goto('/login');
    await field(page, 'Email').fill(EMAIL as string);
    await field(page, 'Password').fill('definitely-not-the-password');
    await submit(page).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(field(page, 'Authenticator code')).toBeHidden();
  });
});

test.describe('the password field', () => {
  /**
   * Every password field in SAFRA carries a show/hide toggle — a project rule, not a
   * preference. Asserted through the DOM because the only thing that matters is whether
   * the input's `type` actually changes.
   */
  test('reveals and re-masks the password', async ({ page }) => {
    await page.goto('/login');

    const password = field(page, 'Password');
    await password.fill(PASSWORD as string);

    await expect(password).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    // The value survives the switch — a toggle that clears the field is worse than none.
    await expect(password).toHaveValue(PASSWORD as string);

    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(password).toHaveAttribute('type', 'password');
  });

  /**
   * The eye must sit INSIDE the input, not below or beside it.
   *
   * Asserted geometrically because the failure mode is invisible to any DOM assertion:
   * the markup and the class names were correct while Tailwind was not scanning the
   * shared package, so none of the positioning classes existed and the button rendered
   * as a plain block after the input. Measuring the boxes is the only check that can
   * tell the difference between "styled" and "the CSS was never generated".
   */
  test('the eye is positioned inside the input', async ({ page }) => {
    await page.goto('/login');

    const input = await field(page, 'Password').boundingBox();
    const eye = await page.getByRole('button', { name: 'Show password' }).boundingBox();

    expect(input, 'password input has no box').not.toBeNull();
    expect(eye, 'toggle has no box').not.toBeNull();

    const i = input as NonNullable<typeof input>;
    const e = eye as NonNullable<typeof eye>;

    // One pixel of tolerance for sub-pixel layout and the input's border.
    expect(e.x, 'eye starts left of the input').toBeGreaterThanOrEqual(i.x);
    expect(e.x + e.width, 'eye overflows the input on the right').toBeLessThanOrEqual(
      i.x + i.width + 1,
    );
    expect(e.y, 'eye sits above the input').toBeGreaterThanOrEqual(i.y - 1);
    expect(e.y + e.height, 'eye sits below the input').toBeLessThanOrEqual(
      i.y + i.height + 1,
    );

    // And on the right-hand side of it, not floating in the middle of the text.
    expect(e.x, 'eye is not on the right').toBeGreaterThan(i.x + i.width / 2);
  });

  /** It must not submit the form it sits inside. */
  test('toggling does not submit the form', async ({ page }) => {
    await page.goto('/login');
    await field(page, 'Email').fill(EMAIL as string);
    await field(page, 'Password').fill(PASSWORD as string);

    await page.getByRole('button', { name: 'Show password' }).click();

    // Still on step one: no code field, no error.
    await expect(field(page, 'Authenticator code')).toBeHidden();
    await expect(submit(page)).toBeVisible();
  });
});
