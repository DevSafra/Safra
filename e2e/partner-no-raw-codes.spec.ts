import { expect, test } from '@playwright/test';

import { PARTNER_BASE, PARTNER_STATE } from './partner-session.js';

/**
 * The partner portal, swept for technical codes on screen.
 *
 * The console's half of this is `no-raw-codes.spec.ts`, which carries the reasoning and the finding
 * that motivated both — `system.partner_no_response` printed raw on 11,646 audit rows. Bashar's
 * instruction covers all three applications: *«I do not want users, partners or administrators
 * seeing technical codes where human-readable values should be displayed.»*
 *
 * A partner sees fewer screens than an operator and reads none of the platform's internals, so an
 * identifier here would be a plainer failure: nothing on this side of the product has a legitimate
 * reason to show one, which is why there is no allow-list.
 */
const SCREENS = [
  '/',
  '/properties',
  '/calendars',
  '/arrivals',
  '/contracts',
  '/coupons',
  '/disputes',
  '/employees',
  '/employee-roles',
  '/payouts',
  '/payouts/accounts',
  '/reviews',
  '/support',
  '/violations',
];

const IDENTIFIER = /\b[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*(?:_[a-z0-9]+)+\b/g;

test.use({ baseURL: PARTNER_BASE, storageState: PARTNER_STATE });

test('no partner screen shows a technical code as a value', async ({ page }) => {
  const found: string[] = [];
  let read = 0;

  for (const path of SCREENS) {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });

    expect(response?.status(), `${path} did not render`).toBeLessThan(400);

    const text = await page.locator('main').innerText();

    read += text.length;

    for (const token of new Set(text.match(IDENTIFIER) ?? [])) {
      found.push(`${path} — «${token}»`);
    }
  }

  /*
    The control: a walk that read nothing would report perfect health. Asserted on the CHARACTERS
    read rather than on the screen count, because a redirect to the sign-in page still counts as a
    screen and would still be 200.
  */
  expect(read, 'the sweep read real screens').toBeGreaterThan(2000);

  expect(
    [...new Set(found)].sort(),
    'A technical code is on a partner screen where a word belongs. Resolve it through the ' +
      'catalogue — the canonical status vocabulary covers every state, and `@safra/i18n` covers ' +
      'the rest.',
  ).toStrictEqual([]);
});

/** A dispute's own screen, which no navigation links to and a walk of the list would miss. */
test('nor does a dispute’s own screen', async ({ page }) => {
  await page.goto('/disputes', { waitUntil: 'domcontentloaded' });

  const rows = page.locator('[data-dispute]');

  test.skip((await rows.count()) === 0, 'No disputes against this fixture partner.');

  const reference = await rows.first().getAttribute('data-dispute');

  await page.goto(`/disputes/${reference}`, { waitUntil: 'domcontentloaded' });

  const text = await page.locator('main').innerText();

  expect(text.length, 'the case file rendered').toBeGreaterThan(200);
  expect([...new Set(text.match(IDENTIFIER) ?? [])].sort()).toStrictEqual([]);
});
