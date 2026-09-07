import { expect, test } from '@playwright/test';

import { STAFF_STATE } from './staff.js';

/**
 * A refund the CUSTOMER can see.
 *
 * ## The defect this holds
 *
 * The platform had written 15,671 `booking.refund_issued` timeline events and the console read
 * them. The customer's own booking page said nothing about any of them — not the amount, not when,
 * not whether it had completed. Money moved and the person it moved to had no record of it on the
 * platform: the same asymmetry the partner's frozen payout had, on the other side of the
 * transaction.
 *
 * So this issues a refund the way an operator does and then signs in as the customer and reads
 * their own booking.
 */
const CONSOLE = 'http://localhost:3001';
const WEB = 'http://localhost:3000';
const PASSWORD = process.env['TESTBED_PASSWORD'] ?? 'a-testbed-password-1';
const EMAIL = 'customer@safra.test';

test.describe.configure({ mode: 'serial' });

let reference = '';

test('an operator refunds a booking of this customer', async ({ browser }) => {
  /*
    The customer's own references, read off their own account.

    The console's registry search matches a reference or a name, not an email — the first version
    searched by email, found nothing, and reported the console broken. Support gets a reference
    from the guest, so this does too.
  */
  const customer = await browser.newContext();
  const own = await customer.newPage();
  const candidates: string[] = [];

  try {
    await own.goto(`${WEB}/en/login?next=%2Fen%2Faccount%2Fbookings`);
    await own.getByLabel('Email').fill(EMAIL);
    await own.locator('input[type=password]').first().fill(PASSWORD);
    await own.getByRole('button', { name: 'Sign in' }).first().click();
    await own.waitForURL(/\/account\/bookings/, { timeout: 25_000 });

    for (const match of (await own.locator('main').innerText()).matchAll(
      /BKG-\d{4}-\d+/g,
    )) {
      candidates.push(match[0]);
    }

    expect(candidates.length, 'this customer has bookings').toBeGreaterThan(0);

    /*
      One that ALREADY shows a refund will do, and it is checked on the customer's own page —
      the surface this spec is about.

      Two earlier versions got this wrong: the first insisted on issuing a refund, so a re-run with
      everything already refunded found no candidate; the second looked for the CUSTOMER app's
      wording on the CONSOLE, which uses different words for the same fact.
    */
    for (const candidate of candidates.slice(0, 10)) {
      await own.goto(`${WEB}/en/account/bookings/${candidate}`, {
        waitUntil: 'domcontentloaded',
      });

      if ((await own.locator('[data-refunds]').count()) > 0) {
        reference = candidate;
        break;
      }
    }
  } finally {
    await customer.close();
  }

  const staff = await browser.newContext({ storageState: STAFF_STATE });
  const page = await staff.newPage();

  try {
    /* Nothing refunded yet: walk them until one offers a refund that can complete. */
    for (const candidate of reference === '' ? candidates.slice(0, 10) : []) {
      await page.goto(`${CONSOLE}/bookings/${candidate}`, {
        waitUntil: 'domcontentloaded',
      });

      /*
        The TOGGLE, which shares its label «استرداد» with the form's own submit — so it is taken as
        the first of them rather than by name alone. The first version pressed a «تنفيذ الاسترداد»
        that does not exist and hung for three minutes waiting for a request nothing had sent.
      */
      const toggle = page.getByRole('button', { name: 'استرداد', exact: true }).first();

      if ((await toggle.count()) === 0) continue;

      await toggle.click();

      const form = page.locator('form').filter({ hasText: 'سبب الاسترداد' });

      if ((await form.count()) === 0) continue;

      await form
        .locator('textarea[name="reason"]')
        .fill('استرداد أُنشئ أثناء اختبار آلي للتحقق من ظهوره للعميل.');

      const submit = form.getByRole('button', { name: 'استرداد', exact: true });

      /*
        A booking with nothing refundable DISABLES the submit — the cancellation policy may leave
        no money to return. That is the control being honest, not a failure, so this walks on to
        the next candidate rather than pressing a dead button.
      */
      if (await submit.isDisabled()) continue;

      const issued = page.waitForResponse(
        (r) => r.url().includes('/refund') && r.request().method() === 'POST',
        { timeout: 30_000 },
      );

      await submit.click();

      const response = await issued.catch(() => null);

      if (response?.ok()) {
        reference = candidate;
        break;
      }
    }

    expect(reference, 'a refund was issued through the console').not.toBe('');
  } finally {
    await staff.close();
  }
});

test('the customer sees the refund on their own booking', async ({ browser }) => {
  test.skip(reference === '', 'no refund was issued');

  const customer = await browser.newContext();
  const page = await customer.newPage();

  try {
    await page.goto(
      `${WEB}/en/login?next=${encodeURIComponent(`/en/account/bookings/${reference}`)}`,
    );
    await page.getByLabel('Email').fill(EMAIL);
    await page.locator('input[type=password]').first().fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).first().click();
    await page.waitForURL(new RegExp(`/account/bookings/${reference}`), {
      timeout: 25_000,
    });

    const refunds = page.locator('[data-refunds]');

    await expect(refunds, 'the refund is on the customer’s own booking').toBeVisible();

    /*
      The AMOUNT, and what it says about timing. «قيد التنفيذ» is the answer to the question a
      customer actually has — «where is my money» — and the reason they would otherwise write to
      support.
    */
    /*
      An EXACT figure — two decimal places.

      It rendered «$330» beside a total of «$661.99»: two precisions for money on one screen, and
      the trimmed one is the number a customer goes looking for on their card statement.
    */
    await expect(refunds, 'with an exact figure').toContainText(/\d+\.\d{2}/);
    await expect(refunds, 'and what happens next').toContainText(
      /In progress|Completed on/,
    );

    /* WHY it was this much — from the cancellation policy, as a percentage. */
    await expect(refunds, 'and why it was this much').toContainText(/%/);

    /*
      And NOT the plumbing, and NOT the staff prose.

      A payment-processor reference is the wrong thing for a customer to quote to their bank, and
      the member of staff who issued a refund is not a fact about the customer's booking. The
      free-text REASON is excluded for a sharper reason: the console describes that field as
      internal, and 15,671 of them were written by staff under exactly that assumption — so
      showing it here would surface internal prose to customers retroactively. This spec created
      one whose text it knows, which is what makes the assertion mean something.
    */
    const shown = await page.locator('main').innerText();

    expect(shown, 'no provider reference').not.toMatch(/pi_|ch_|re_[A-Za-z0-9]{8}/);
    expect(shown.toLowerCase(), 'no staff email').not.toContain('@safra.test');
    expect(shown, 'no internal refund prose').not.toContain('اختبار آلي');
  } finally {
    await customer.close();
  }
});
