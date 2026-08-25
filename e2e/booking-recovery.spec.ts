import { expect, test } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * EC-010 — recovering a booking somebody has lost the reference to (SRS §16).
 *
 * ## What a browser can prove that an integration test cannot
 *
 * `booking-recovery.integration.test.ts` holds the security properties: the same answer either
 * way, the code never stored, the ceiling on guesses. What it cannot see is the SEAL — that
 * nothing about the booking is on the console screen until the code passes. That is a rendering
 * question, and rendering is where a leak of this kind would actually happen: a panel that showed
 * the property name above the code field would satisfy every server-side assertion in the file.
 */
const copy = t.sections.bookingVerify;

test.describe('the customer side', () => {
  /* The customer app, not the console — the config's `baseURL` is 3001. */
  test.use({ baseURL: 'http://localhost:3000' });

  /**
   * The page must answer identically whether or not the address holds a booking.
   *
   * Asserted by COMPARING the two renderings rather than by reading one of them: «the same
   * message» is the property, and a test that only checked the known-good address would pass
   * against a page that said «no bookings found» for the other — which is the oracle this whole
   * design exists to refuse.
   */
  test('says the same thing for an address with bookings and one without', async ({
    page,
  }) => {
    const answers: string[] = [];

    for (const email of ['guest5@safra.test', 'nobody-at-all@safra.test']) {
      await page.goto('/ar/find-booking');
      await page.locator('input[name="email"]').fill(email);
      /*
        One CSS chain, naming the form by its field and the button by its type.

        The layout carries a currency switcher, which is a second form with three buttons — so a
        bare `getByRole('button')` is a strict-mode violation, and so is Playwright's `filter({has})`
        here because the inner locator resolves against the page rather than the form.
      */
      await page.locator('form:has(input[name="email"]) button[type="submit"]').click();
      await expect(page.getByRole('status')).toBeVisible({ timeout: 20_000 });

      answers.push((await page.getByRole('status').innerText()).trim());

      /* The field goes, so nobody can sit here trying addresses and reading the difference. */
      await expect(page.locator('input[name="email"]')).toHaveCount(0);
    }

    expect(answers[0], 'the answer must not depend on what was found').toBe(answers[1]);
  });
});

test.describe('the staff side', () => {
  test.skip(MISSING_CREDENTIALS, SKIP_REASON);
  test.use({ storageState: STAFF_STATE });

  /**
   * The seal, which is the whole reason this is a screen of its own.
   *
   * A control on §9.4 would have rendered the property, the dates and the customer's name above
   * it. Here the agent holds a reference they typed and a MASKED destination, and nothing else,
   * until the caller reads the code back.
   */
  test('shows nothing about the booking before the code is verified', async ({
    page,
  }) => {
    await page.goto('/bookings?size=5');

    /* From the HREF, not the link text — the action column links to the same booking with a word. */
    const reference =
      /BKG-[\w-]+/.exec(
        (await page.locator('a[href^="/bookings/BKG-"]').first().getAttribute('href')) ??
          '',
      )?.[0] ?? '';

    test.skip(reference === '', 'No booking to verify against.');

    await page.goto('/bookings/verify');
    await expect(page.getByText(copy.sealed)).toBeVisible();

    await page.locator('input[name="reference"]').fill(reference);
    await page.getByRole('button', { name: copy.send }).click();

    const sent = page.getByText(/أُرسل رمز إلى/);

    await expect(sent).toBeVisible({ timeout: 20_000 });

    /* A MASK, not an address — the agent has not yet established the caller owns it. */
    await expect(sent).toContainText('•');

    /* Still sealed: no link into the booking, and no confirmation. */
    await expect(page.locator(`a[href="/bookings/${reference}"]`)).toHaveCount(0);
    await expect(page.getByText(copy.verified)).toHaveCount(0);

    /* A wrong code changes none of that, and says nothing about which kind of wrong it was. */
    await page.locator('input[name="code"]').fill('000000');
    await page.getByRole('button', { name: copy.confirm }).click();

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`a[href="/bookings/${reference}"]`)).toHaveCount(0);
  });
});
