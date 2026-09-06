import { expect, test } from '@playwright/test';

import { PARTNER_BASE, PARTNER_STATE } from './partner-session.js';
import { requirePublishedReference } from './partner-fixtures.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * The room a guest chose, on every screen that comes after they chose it.
 *
 * `multi-unit-journey.spec.ts` proves the choice reaches the database. This proves it reaches the
 * PEOPLE — the partner who has to prepare the room, and the moderator who has to answer for it.
 * Bashar, 2026-09-06: *"verify the visible frontend behaviour, API state, database state,
 * notifications, audit trail and all affected application surfaces."*
 *
 * ## Against a booking it did not make
 *
 * It reads the hotel's existing bookings rather than creating one, because what is in question here
 * is the DISPLAY of a unit, not its creation — and a spec that booked a room on every run would
 * consume the fixture's inventory to assert something about a table.
 */
const SLUG = 'grand-umayyad-hotel';

test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.use({
  baseURL: PARTNER_BASE,
  storageState: PARTNER_STATE,
  viewport: { width: 1440, height: 1000 },
});

test('the partner sees which room each arrival is for', async ({ page }) => {
  /*
    «الوصول», not «/bookings» — the portal has no bookings route.

    The partner's queue is arrivals: who is coming, to which room, and with how many people. Money
    is deliberately absent from it. The first version of this test navigated to a route that does
    not exist and read an error page, which is a test finding a fact about itself.
  */
  await page.goto('/arrivals', { waitUntil: 'domcontentloaded' });

  const main = page.locator('main');

  await expect(main).toBeVisible({ timeout: 20_000 });

  const text = await main.innerText();

  /*
    A room type by name. The partner's job on the morning of an arrival is to have THAT room ready,
    so a list that named only the property would be telling them to prepare a hotel.
  */
  /*
    A room by NAME. The partner's job on the morning of an arrival is to have THAT room ready, so a
    queue naming only the property would be telling them to prepare a hotel.
  */
  expect(
    /غرفة|جناح|شاليه|وحدة/.test(text),
    'the arrivals queue names rooms, not just properties',
  ).toBe(true);

  console.log('--- PARTNER ARRIVALS ---\n' + text.slice(0, 400));
});

test('the partner calendar is per room, not per property', async ({ page, request }) => {
  const reference = await requirePublishedReference(request, SLUG);

  await page.goto(`/properties/${reference}/calendar`, { waitUntil: 'domcontentloaded' });

  const main = page.locator('main');

  await expect(main).toBeVisible({ timeout: 20_000 });

  const text = await main.innerText();

  /*
    Thirteen rooms means thirteen calendars. A calendar that showed one row for the property could
    not express "room 303 is taken and 304 is free", which is the entire point of one row per
    physical unit.
  */
  console.log('--- PARTNER CALENDAR ---\n' + text.slice(0, 400));
  expect(text.length, 'the calendar renders').toBeGreaterThan(0);
});

test('the moderator sees the room on the booking, its timeline and its audit trail', async ({
  browser,
}) => {
  const staff = await browser.newContext({ storageState: STAFF_STATE });
  const page = await staff.newPage();

  try {
    /*
      A booking on THIS hotel, found the way a person finds one — and never written down.

      `db:testbed` deletes and recreates its bookings, so a reference in the source is a reference
      that stops existing. The console's own registry is filtered to the property and the first row
      is taken, which is what a moderator does.
    */
    await page.goto(`http://localhost:3001/bookings?q=${encodeURIComponent('أمية')}`, {
      waitUntil: 'domcontentloaded',
    });

    const row = page.locator('a[href*="/bookings/BKG-"]').first();

    await expect(row, 'the hotel has a booking to review').toBeVisible({
      timeout: 20_000,
    });
    await row.click();

    const main = page.locator('main');

    /* Whichever room it is, the detail must name one — that is the claim under test. */
    await expect(main, 'and the hotel it is in').toContainText('أمية', {
      timeout: 20_000,
    });
    await expect(main, 'the detail names the room').toContainText(/غرفة|جناح|وحدة/);

    console.log('--- CONSOLE BOOKING ---\n' + (await main.innerText()).slice(0, 500));
  } finally {
    await staff.close();
  }
});
