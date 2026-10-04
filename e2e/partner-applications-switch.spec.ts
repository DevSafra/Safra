import { expect, test, type Browser, type Page } from '@playwright/test';

import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';
import web from '../packages/i18n/src/messages/web/ar.json' assert { type: 'json' };
import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { ERROR } from '../packages/contracts/src/error-codes.js';

/**
 * «سجّل كشريك», switched off and on from الإعدادات (Bashar, 2026-10-04).
 *
 * Off means «hide the سجل كشريك on the entire system», so every surface that offers it is checked
 * by name, at the width where it is drawn: the header link (xl and up), the phone menu, the footer,
 * the partner sections of الرئيسية and «عن سفرة», the customer's account sidebar, and the page
 * itself. Then the tampered path: a signed-in customer POSTing the form anyway gets the API's
 * refusal, because a hidden link is a courtesy and the endpoint is the control.
 *
 * ## The opposite control, every time
 *
 * Each absence is asserted again as a PRESENCE after the switch goes back on. «Not there» is
 * indistinguishable from «a locator that matches nothing», and the second half is what proves the
 * first half was looking at something real. It is also what puts the shared database back.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.describe.configure({ mode: 'serial' });

const WEB = 'http://localhost:3000';
const KEY = 'partner.applications_open';
const CUSTOMER = 'customer@safra.test';
const PASSWORD = process.env['TESTBED_PASSWORD'] ?? 'a-testbed-password-1';

/* The console's switch. Every change asks first, in the console's own popup. */
async function setOpen(page: Page, open: boolean): Promise<void> {
  await page.goto('/settings');

  const toggle = page.locator(`[data-setting-row="${KEY}"]`).getByRole('switch');

  await expect(toggle).toBeVisible();

  if ((await toggle.getAttribute('aria-checked')) !== String(open)) {
    await toggle.click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: t.sections.dialog.confirm })
      .click();
  }

  await expect(toggle).toHaveAttribute('aria-checked', String(open));
}

/*
  The site's settings fetch is purged by the API on save, with a thirty-second floor if that call
  is missed. Polled rather than slept, so a working purge costs one load.
*/
async function homeShows(page: Page, open: boolean): Promise<void> {
  await expect(async () => {
    await page.goto(`${WEB}/ar`);
    await expect(
      page.locator('footer').getByRole('link', { name: web.footer.becomePartner }),
    ).toHaveCount(open ? 1 : 0, { timeout: 1_000 });
  }).toPass({ timeout: 45_000 });
}

async function signedInCustomer(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(`${WEB}/ar/login?next=%2Far%2Faccount`);
  await page.getByLabel(web.auth.email).fill(CUSTOMER);
  await page.locator('input[type=password]').first().fill(PASSWORD);
  await page.getByRole('button', { name: web.auth.signIn }).first().click();
  await page.waitForURL(/\/ar\/account/, { timeout: 20_000 });

  return page;
}

test.use({ storageState: STAFF_STATE, viewport: { width: 1440, height: 900 } });

test('closed: «سجّل كشريك» is nowhere on the site and the API refuses it; open: it is back', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);

  const visitor = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const customer = await signedInCustomer(browser);

  /* Every surface, in one place, so the closed and open halves check exactly the same list. */
  const surfaces = async (open: boolean) => {
    const count = open ? 1 : 0;

    await homeShows(visitor, open);
    await expect(
      visitor.locator('header').getByRole('link', { name: web.home.partnersCta }),
      'header link',
    ).toHaveCount(count);
    await expect(
      visitor.getByRole('region', { name: web.home.partnersTitle }),
      'home partner section',
    ).toHaveCount(count);

    await visitor.goto(`${WEB}/ar/about`);
    await expect(
      visitor.getByRole('region', { name: web.home.partnersSubtitle }),
      'about partner section',
    ).toHaveCount(count);

    await phone.goto(`${WEB}/ar`);
    await phone.getByRole('button', { name: web.nav.openMenu }).click();
    await expect(
      phone.getByRole('dialog').getByRole('link', { name: web.home.partnersCta }),
      'phone menu link',
    ).toHaveCount(count);

    await customer.goto(`${WEB}/ar/account`);
    await expect(
      customer.locator('aside').getByRole('link', { name: web.footer.becomePartner }),
      'account sidebar link',
    ).toHaveCount(count);

    const join = await customer.goto(`${WEB}/ar/partners/join`);
    expect(join?.status(), 'the page itself').toBe(open ? 200 : 404);
  };

  try {
    await setOpen(page, false);
    await surfaces(false);

    /*
      The tampered path: the form's own endpoint, with a valid session and a valid body. The page
      that would send it is gone, so this is the request somebody builds by hand.
    */
    const posted = await customer.request.post(`${WEB}/ar/api/partner-applications`, {
      data: {
        contactName: 'اختبار الإغلاق',
        phone: '+963116414444',
        legalName: 'شركة اختبار الإغلاق',
        displayName: 'اختبار الإغلاق',
        partnerTypeCode: 'accommodation',
        citySlug: 'damascus',
        address: 'شارع الاختبار 1',
        preferredLocale: 'ar',
      },
    });

    expect(posted.status()).toBe(403);
    expect(((await posted.json()) as { code?: string }).code).toBe(
      ERROR.PARTNER_APPLICATIONS_CLOSED,
    );
  } finally {
    /* Back on, whatever happened above: the suite shares one database. */
    await setOpen(page, true);
  }

  await surfaces(true);
});
