import { expect, test, type Page } from '@playwright/test';

/**
 * The registration phone field (Bashar, 2026-08-18).
 *
 * A browser spec rather than a unit test because every part of this is a rendering question that
 * `pnpm verify` is structurally unable to see: what a native `<select>` reports, what the bidi
 * algorithm does to `+963` on an Arabic line, and — the one that would ship silently — whether the
 * counter's digits come out Western.
 */
test.use({ baseURL: 'http://localhost:3000' });

const field = {
  country: (page: Page) => page.getByTestId('phone-country'),
  national: (page: Page) => page.locator('#field-phone'),
  /** What the form actually posts. The visible inputs are the interface; this is the value. */
  posted: (page: Page) => page.locator('input[name="phone"][type="hidden"]'),
  counter: (page: Page) =>
    page.locator('#field-phone-hint').locator('xpath=following-sibling::span[1]'),
};

test('opens on Syria with the launch markets first', async ({ page }) => {
  await page.goto('/en/register');

  await expect(field.country(page)).toHaveValue('SY');

  /*
    Asserted as the first THREE, in order, rather than "contains Syria": the pinning is the
    feature, and a sort that quietly reverted would still contain all three.
  */
  const first = await field
    .country(page)
    .locator('option')
    .evaluateAll((options) =>
      options.slice(0, 3).map((option) => option.textContent?.trim()),
    );

  expect(first).toStrictEqual(['🇸🇾 +963 Syria', '🇯🇴 +962 Jordan', '🇱🇧 +961 Lebanon']);
});

test('posts E.164 and drops the trunk zero a person actually types', async ({ page }) => {
  await page.goto('/en/register');

  // Empty is EMPTY, not a bare '+963' — a lone calling code would pass a careless schema.
  await expect(field.posted(page)).toHaveValue('');

  await field.national(page).fill('0933123456');
  await expect(field.posted(page)).toHaveValue('+963933123456');
});

test('the counter follows the chosen country', async ({ page }) => {
  await page.goto('/en/register');

  await expect(field.counter(page)).toHaveText('0/9');

  await field.country(page).selectOption('US');
  await field.national(page).fill('2015550123');
  await expect(field.counter(page)).toHaveText('10/10');

  // Germany expects eleven, so the same digits now read as incomplete rather than done.
  await field.country(page).selectOption('DE');
  await expect(field.counter(page)).toHaveText('10/11');
});

/**
 * The counter is Western on the ARABIC page.
 *
 * `{typed}` handed to ICU as a NUMBER is formatted for the locale, and `ar` renders `٠/٩`. The
 * catalogue sweep in `completeness.test.ts` cannot see this — the digits are not in the
 * catalogue, they are produced at render — so this is the only check that holds the
 * 2026-08-17 rule for this field.
 */
test('writes the counter in Western digits in Arabic', async ({ page }) => {
  await page.goto('/ar/register');

  await field.national(page).fill('933123456');

  await expect(field.counter(page)).toHaveText('9/9');
  await expect(field.counter(page)).not.toHaveText(/[٠-٩]/);
});

test('the country name is announced, and never says the same thing 245 times', async ({
  page,
}) => {
  await page.goto('/de/register');

  // The visible summary is aria-hidden, so the select's own label is what a reader hears.
  await expect(field.country(page)).toHaveAttribute('aria-label', 'Ländervorwahl');

  const options = await field
    .country(page)
    .locator('option')
    .evaluateAll((all) => all.map((option) => option.textContent?.trim()));

  expect(options).toHaveLength(245);
  expect(new Set(options).size).toBe(245);
  expect(options).toContain('🇩🇪 +49 Deutschland');
});

/**
 * An empty number is refused BEFORE the network, and in words this field can be acted on.
 *
 * Two things are asserted together because either alone would pass on a broken build. The form is
 * `noValidate`, so `required` does not stop a submission — without the guard in `auth-form` the
 * request goes out and comes back with `validation.phone_format`, whose sentence tells the
 * customer to type «+963912345678» into a field that takes national digits only.
 */
test('refuses an empty number without asking the API, and says something followable', async ({
  page,
}) => {
  await page.goto('/en/register');

  const posted: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/auth/register')) posted.push(request.url());
  });

  await page.locator('input[name=fullName]').fill('Validator Probe');
  await page.locator('input[name=email]').fill('probe@example.test');
  await page.locator('select[name=gender]').selectOption('undisclosed');
  await page.locator('input[name=password]').fill('A-Long-Passphrase-1!');
  await page.locator('input[name=confirm]').fill('A-Long-Passphrase-1!');

  await page.getByRole('button', { name: 'Create an account' }).click();

  await expect(page.locator('#field-phone-error')).toHaveText(
    'That phone number does not look complete. Check the digits and the country you chose.',
  );
  expect(posted).toStrictEqual([]);

  /* And `required` is still on the input, which is what assistive technology reads. */
  await expect(page.locator('#field-phone')).toHaveAttribute('required', '');
});

/**
 * A number that is well-formed and does not exist is refused, before the network.
 *
 * `912345678` is the case worth keeping: it was this project's own example number for months, it
 * passes the E.164 regex, and Syria has no 91x range. The message names the COUNTRY, because the
 * country is the thing the reader chose and might have chosen wrongly.
 */
test('refuses a well-formed number that does not exist', async ({ page }) => {
  await page.goto('/en/register');

  const posted: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/auth/register')) posted.push(request.url());
  });

  await page.locator('input[name=fullName]').fill('Validator Probe');
  await page.locator('input[name=email]').fill('probe@example.test');
  await page.locator('select[name=gender]').selectOption('undisclosed');
  await page.locator('input[name=password]').fill('A-Long-Passphrase-1!');
  await page.locator('input[name=confirm]').fill('A-Long-Passphrase-1!');

  // Right shape, no such Syrian range.
  await field.national(page).fill('912345678');
  await expect(field.posted(page)).toHaveValue('+963912345678');

  await page.getByRole('button', { name: 'Create an account' }).click();

  await expect(page.locator('#field-phone-error')).toHaveText(
    'That number is not valid in the country selected. Check it, or choose another country.',
  );
  expect(posted).toStrictEqual([]);

  /* And a real one clears it and is allowed through to the API. */
  await field.national(page).fill('933123456');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect.poll(() => posted.length).toBeGreaterThan(0);
});
