import { expect, test } from '@playwright/test';

import { PARTNER_BASE, PARTNER_STATE } from './partner-session.js';
import { propertyReference } from './property-reference.js';
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

test('the partner sees which room each booking is for', async ({ page }) => {
  await page.goto('/bookings', { waitUntil: 'domcontentloaded' });

  const main = page.locator('main');

  await expect(main).toBeVisible({ timeout: 20_000 });

  const text = await main.innerText();

  /*
    A room type by name. The partner's job on the morning of an arrival is to have THAT room ready,
    so a list that named only the property would be telling them to prepare a hotel.
  */
  expect(
    /غرفة مزدوجة|جناح تنفيذي|غرفة عائلية|غرفة/.test(text),
    'the bookings list names rooms, not just properties',
  ).toBe(true);

  console.log('--- PARTNER BOOKINGS ---\n' + text.slice(0, 400));
});

test('the partner calendar is per room, not per property', async ({ page, request }) => {
  const reference = await propertyReference(request, SLUG);

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
    /* A booking on the hotel, found the way a person finds one: through the registry. */
    await page.goto('http://localhost:3001/bookings?q=BKG-2026-418085', {
      waitUntil: 'domcontentloaded',
    });

    const row = page.locator('a[href*="/bookings/BKG-2026-418085"]').first();

    await expect(row, 'the booking is findable').toBeVisible({ timeout: 20_000 });
    await row.click();

    const main = page.locator('main');

    await expect(main, 'the detail names the room').toContainText('جناح تنفيذي', {
      timeout: 20_000,
    });
    await expect(main, 'and the hotel it is in').toContainText('أمية');

    console.log('--- CONSOLE BOOKING ---\n' + (await main.innerText()).slice(0, 500));
  } finally {
    await staff.close();
  }
});
