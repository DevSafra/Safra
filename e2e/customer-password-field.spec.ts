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

  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
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
