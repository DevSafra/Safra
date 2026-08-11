import { expect, test, type Page } from '@playwright/test';

/**
 * The password toggle in the CUSTOMER app.
 *
 * A separate spec because the rule is "every password field in SAFRA", and the shared
 * component being correct in the staff console proves nothing about whether the customer
 * app actually uses it. This is the check that the rule holds across both apps rather
 * than in the one place it was first applied.
 */
test.use({ baseURL: 'http://localhost:3000' });

/**
 * Fields are located by ROLE, not by label text.
 *
 * `getByLabel` matches a label's raw `textContent`, so it sees "Password *" — the
 * decorative asterisk the customer app appends — and it also matches the "Show password"
 * toggle by substring. Role-name computation respects `aria-hidden` and cannot collide
 * with a button, so it resolves to exactly the input in both apps.
 */
/** From the environment, not this file — see the note in `staff-login.spec.ts`. */
const PASSWORD = process.env['DEV_CUSTOMER_PASSWORD'];

test.skip(!PASSWORD, 'DEV_CUSTOMER_PASSWORD is not set — run via `pnpm e2e`');

const field = (page: Page, name: string) =>
  page.getByRole('textbox', { name, exact: true });

test('the sign-in password can be revealed and re-masked', async ({ page }) => {
  await page.goto('/en/login');

  const password = field(page, 'Password');
  await password.fill(PASSWORD as string);

  await expect(password).toHaveAttribute('type', 'password');

  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue(PASSWORD as string);

  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
});

test('the registration password has the toggle too', async ({ page }) => {
  await page.goto('/en/register');

  const password = field(page, 'Password');
  await expect(password).toHaveAttribute('type', 'password');

  /* `.first()`: the confirmation field added in 2026-08-11 brings a second toggle onto this page. */
  await page.getByRole('button', { name: 'Show password' }).first().click();
  await expect(password).toHaveAttribute('type', 'text');
});

/**
 * Registering asks for the password twice, and signing in does not.
 *
 * One component renders both screens, so the confirmation has to appear on exactly one of them — the
 * register-only branch is the thing worth asserting. Nothing is submitted: no account is created, and
 * the mismatch rule itself is proven in `password-match.test.ts`.
 */
test('registration confirms the password and sign-in does not', async ({ page }) => {
  await page.goto('/en/register');
  await expect(page.locator('input[name=password]')).toHaveCount(1);
  await expect(page.locator('input[name=confirm]')).toHaveCount(1);

  await page.goto('/en/login');
  await expect(page.locator('input[name=password]')).toHaveCount(1);
  await expect(
    page.locator('input[name=confirm]'),
    'signing in must not ask for a confirmation',
  ).toHaveCount(0);
});

/**
 * Geometry, in this app too.
 *
 * The shared component being correct in the staff console proves nothing here: the
 * missing piece was a Tailwind `@source` directive, which each app declares in its own
 * stylesheet. One app can have it and the other not.
 */
test('the eye is positioned inside the input', async ({ page }) => {
  await page.goto('/en/login');

  const input = await field(page, 'Password').boundingBox();
  const eye = await page.getByRole('button', { name: 'Show password' }).boundingBox();

  expect(input).not.toBeNull();
  expect(eye).not.toBeNull();

  const i = input as NonNullable<typeof input>;
  const e = eye as NonNullable<typeof eye>;

  expect(e.x, 'eye starts left of the input').toBeGreaterThanOrEqual(i.x);
  expect(e.x + e.width, 'eye overflows the input on the right').toBeLessThanOrEqual(
    i.x + i.width + 1,
  );
  expect(e.y + e.height, 'eye sits below the input').toBeLessThanOrEqual(
    i.y + i.height + 1,
  );
  expect(e.x, 'eye is not on the right').toBeGreaterThan(i.x + i.width / 2);
});

/**
 * Setting a new password asks for it TWICE (Bashar, 2026-08-11).
 *
 * Tested on the RESET form because it needs no session: the page renders in confirm mode from any
 * `?token=`, so this costs nothing from the sign-in budget that shapes the rest of this suite. The
 * profile form's copy of the same rule is covered by `password-match.test.ts`, which tests the shared
 * function both forms call.
 *
 * The token is deliberately fake but SHAPE-VALID: the page checks it against `/^[A-Za-z0-9_-]{43}$/`
 * and renders an invalid-link notice for anything else, so a short placeholder silently tests the wrong
 * page. Its validity is never checked here — that belongs to the API, and nothing is submitted.
 */
test('a new password is asked for twice, and both fields have the toggle', async ({
  page,
}) => {
  await page.goto('/en/reset-password?token=e2e-not-a-real-reset-token-0000000000000000');

  await expect(field(page, 'New password')).toHaveAttribute('type', 'password');
  await expect(field(page, 'Confirm new password')).toHaveAttribute('type', 'password');

  /* Two independent toggles, not one shared between the fields — `PasswordField` uses `useId`. */
  await expect(page.getByRole('button', { name: 'Show password' })).toHaveCount(2);

  await page.getByRole('button', { name: 'Show password' }).first().click();
  await expect(field(page, 'New password')).toHaveAttribute('type', 'text');
  /* Revealing one must not reveal the other. */
  await expect(field(page, 'Confirm new password')).toHaveAttribute('type', 'password');
});
