import { expect, test } from '@playwright/test';

import { partnerAr } from '../packages/i18n/src/partner.js';
import { PARTNER_STATE } from './partner-session.js';
import { STAFF_STATE } from './staff.js';

/**
 * Findings 213, 214 and 215, driven end to end (Bashar, 2026-09-07).
 *
 * Three defects on one journey, and each is invisible to the unit and integration suites because
 * each lives in what a person MEETS rather than in what a function returns:
 *
 * - **213** — checkout asked a signed-in customer for a name, an email and a phone number, all
 *   empty, and used none of them: `resolveCustomerProfile` returned the session's profile before
 *   reading a field. «I do not want checkout fields that collect information and then ignore it.»
 * - **214** — the payment panel said «no online payment method is available yet, our team will
 *   contact you» and the button under it said «continue to payment», which landed on a page giving
 *   bank details and a reference. One screen said wait, the next said act.
 * - **215** — «قبول» set a confirm state whose primary button was ALSO «قبول». The first press
 *   posts nothing, so a partner who pressed once and looked away had not accepted — on a two-hour
 *   window with a $10 fine at the end of it.
 *
 * The write half of 213 is proven against a real database in `checkout-profile-edit.integration.test.ts`,
 * where it can be rolled back. What is asserted HERE is the half only a browser can see: that the
 * form arrives carrying the profile, that the email cannot be typed into, that the payment panel
 * describes the rail that actually serves the booking, and that one press on «قبول» accepts
 * nothing until a dialog has named what it is about to accept.
 */
const WEB = 'http://localhost:3000';
const CONSOLE = 'http://localhost:3001';
const PARTNER = 'http://localhost:3002';
const PASSWORD = process.env['TESTBED_PASSWORD'] ?? 'a-testbed-password-1';
const CUSTOMER = 'customer@safra.test';

/** A unit belonging to the fixture partner, so the request lands in THEIR queue. */
const UNIT = '01a07c0e-0986-764c-8252-b54663195f67';
const PROPERTY = 'qasr-al-sharq-malki';

/**
 * Nights nothing else in the suite books.
 *
 * Far out, and offset by the run's own clock, because these specs create REAL bookings against a
 * shared testbed: fixed dates make the second run of the day collide with the first and fail as a
 * 409, which reads as a broken checkout rather than as a spent fixture.
 */
function nights(offsetDays: number): { checkIn: string; checkOut: string } {
  const from = new Date(Date.UTC(2028, 0, 1));

  from.setUTCDate(from.getUTCDate() + (Date.now() % 250) + offsetDays);

  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 2);

  return {
    checkIn: from.toISOString().slice(0, 10),
    checkOut: to.toISOString().slice(0, 10),
  };
}

const checkoutUrl = (stay: { checkIn: string; checkOut: string }) =>
  `${WEB}/ar/checkout?property=${PROPERTY}&unitId=${UNIT}&rooms=1` +
  `&checkIn=${stay.checkIn}&checkOut=${stay.checkOut}&adults=2&children=0&infants=0`;

test.describe.configure({ mode: 'serial' });

test('213: a signed-in customer meets their own details, and the email is stated not asked', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${WEB}/ar/login?next=%2Far%2Faccount`);
    await page.locator('input[type="email"]').first().fill(CUSTOMER);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForURL(/\/ar\/account/, { timeout: 25_000 });

    await page.goto(checkoutUrl(nights(0)));

    /*
      Asserted as «carries the profile's values», not «is non-empty». A field that arrives with
      anything in it would satisfy the weaker check, including a placeholder or last session's
      draft — and the defect was precisely that the platform held these and did not use them.
    */
    const name = await page.locator('[name="fullName"]').inputValue();
    const email = await page.locator('[name="email"]').inputValue();
    const phone = await page.locator('[name="phone"]').inputValue();

    expect(name.length, 'the name arrives from the profile').toBeGreaterThan(0);
    expect(email).toBe(CUSTOMER);
    expect(phone, 'the stored number, in E.164').toMatch(/^\+\d{6,}$/);

    /* The sign-in identity is SHOWN. A checkout form must not be able to move somebody's account. */
    await expect(page.locator('[name="email"]')).toHaveAttribute('readonly', /.*/);
    await expect(page.locator('#field-email-hint')).toBeVisible();

    /* And the name and phone stay editable — the customer is allowed to correct them. */
    await expect(page.locator('[name="fullName"]')).not.toHaveAttribute('readonly', /.*/);
    await page.locator('#field-phone').fill('944100400');
    expect(await page.locator('[name="phone"]').inputValue()).toBe('+963944100400');
  } finally {
    await context.close();
  }
});

test('213: guest checkout still collects all three', async ({ browser }) => {
  /*
    The opposite control, and the reason it is a separate test rather than a second assertion: §4
    keeps guest checkout open, and a prefill that also LOCKED a guest's email would make booking
    without an account impossible. «Signed in sees their own» is indistinguishable from «nobody can
    type anything» without this.
  */
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();

  try {
    await page.goto(checkoutUrl(nights(1)));

    expect(await page.locator('[name="fullName"]').inputValue()).toBe('');
    expect(await page.locator('[name="email"]').inputValue()).toBe('');
    await expect(page.locator('[name="email"]')).not.toHaveAttribute('readonly', /.*/);
  } finally {
    await context.close();
  }
});

test('214: the payment panel describes the rail that will actually serve the booking', async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();

  try {
    await page.goto(checkoutUrl(nights(2)));

    const panel = page.locator('fieldset').filter({ hasText: 'طريقة الدفع' });
    const said = await panel.innerText();

    /*
      Which sentence is correct depends on routing, so this asserts the PAIR rather than one
      string: whatever the panel says must agree with what `/payments/methods` reports. Pinning the
      transfer copy alone would fail the day an acquirer is contracted, for no defect at all.
    */
    const offered = (await (
      await context.request.get(
        `${process.env['API_URL'] ?? 'http://localhost:4000'}/api/v1/payments/methods?country=SY`,
      )
    ).json()) as { methods: string[]; offline: boolean };

    if (offered.methods.length > 0) {
      expect(said, 'a chooser, not a notice').toContain('طريقة الدفع');
    } else if (offered.offline) {
      expect(said, 'says money CAN be taken, and how').toContain('حوالة مصرفية');
      expect(said, 'the superseded «we will contact you» is gone').not.toContain(
        'سيتواصل فريقنا معك',
      );
    } else {
      expect(said).toContain('سيتواصل فريقنا معك');
    }
  } finally {
    await context.close();
  }
});

/** Carries the booking from the customer test to the partner one. */
let reference = '';

test('215: a booking reaches the partner queue', async ({ browser }) => {
  const guest = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await guest.newPage();

  try {
    await page.goto(checkoutUrl(nights(3)));
    await page.locator('[name="fullName"]').fill('ضيف اختبار القبول');
    await page.locator('[name="email"]').fill('accept-spec@example.test');
    await page.locator('#field-phone').fill('944100500');
    await page.locator('form button[type="submit"]').first().click();

    await page.waitForURL(/remittance=|\/booking\//, { timeout: 30_000 });

    reference = /SAFRA-(BKG-\d{4}-\d+)/.exec(page.url())?.[1] ?? '';
    expect(
      reference,
      'the booking was created and its transfer reference minted',
    ).toMatch(/^BKG-/);
  } finally {
    await guest.close();
  }

  /* Staff record the transfer, which is what moves it into the partner's two-hour window. */
  const staff = await browser.newContext({ storageState: STAFF_STATE });
  const console_ = await staff.newPage();

  try {
    await console_.goto(`${CONSOLE}/bookings/${reference}`);
    await console_.getByRole('button', { name: 'تأكيد استلام الحوالة' }).click();
    await console_.getByRole('button', { name: 'نعم، وصلت الحوالة' }).click();
    await expect(console_.getByText('قيد التأكيد').first()).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await staff.close();
  }
});

test('215: one press on «قبول» accepts nothing, and the dialog names what it would', async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: PARTNER_STATE });
  const page = await context.newPage();
  const d = partnerAr.dashboard;

  try {
    await page.goto(`${PARTNER}/`);

    const row = page.locator('li', { hasText: reference }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });

    await row.getByRole('button', { name: d.accept, exact: true }).click();

    /*
      The dialog NAMES the booking. A confirm step that repeats the trigger's own word is what this
      finding is: the partner could not tell the two steps apart, so «is there a second step» is
      not the assertion — «does the second step say which booking» is.
    */
    const message = page.locator('#safra-confirm-message');
    await expect(message).toBeVisible();
    await expect(message).toContainText(reference);
    await expect(message).toContainText(d.acceptWarning);

    /* Different WORDS from the trigger, so the two states cannot look alike. */
    expect(d.acceptConfirm).not.toBe(d.accept);
    await expect(page.getByRole('button', { name: d.acceptConfirm })).toBeVisible();

    /* Escape backs out, and backing out must not have accepted anything. */
    await page.keyboard.press('Escape');
    await expect(message).toBeHidden();
    await expect(row.getByRole('button', { name: d.accept, exact: true })).toBeVisible();

    await row.getByRole('button', { name: d.accept, exact: true }).click();
    await page.getByRole('button', { name: d.acceptConfirm }).click();

    /*
      And the row SAYS what happened rather than vanishing. «It disappeared» reads exactly like
      «the deadline passed», which is the ambiguity this finding ends.
    */
    const outcome = row.locator('[role="status"]');
    await expect(outcome).toBeVisible({ timeout: 20_000 });
    await expect(outcome).toContainText(d.accepted);

    /* The two-hour clock stops. A countdown beside «تم قبول الحجز» contradicts it. */
    await expect(row.locator('[data-deadline]')).toBeHidden();
  } finally {
    await context.close();
  }
});
