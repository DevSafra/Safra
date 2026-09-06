import { expect, test } from '@playwright/test';

import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * A real hotel shape, and the room a guest chose staying the room they get.
 *
 * ## Why this fixture exists
 *
 * The testbed had 1,539 published properties with exactly one unit and eight with two, so the
 * accommodation-selection journey — the one a guest actually walks — was only ever exercised
 * against a list of one. Bashar, 2026-09-06: *"I want it exercised against realistic hotel
 * structures rather than mostly single-unit properties."*
 *
 * `grand-umayyad-hotel` is thirteen rooms in four types: six interchangeable standard doubles,
 * four with a sea view, two suites and a family room, differing on price, occupancy, layout,
 * minimum stay and facilities — because a fixture whose types differ only by name cannot show that
 * a screen tells them apart.
 *
 * ## What it proves
 *
 * That thirteen physical rooms read as FOUR choices with counts, not thirteen rows; that each
 * choice states its own terms; that the one a guest picks is the one checkout quotes; and that the
 * building's facilities stay separate from the room's the whole way.
 */
const SLUG = 'grand-umayyad-hotel';
const PROPERTY = 'PRO-598653';

const TYPES = [
  { name: 'غرفة مزدوجة قياسية', left: '6 غرف متبقية' },
  { name: 'غرفة مزدوجة بإطلالة', left: '4 غرف متبقية' },
  { name: 'جناح تنفيذي', left: 'غرفتان متبقيتان' },
  /* One of it, so it must carry NO count — the control that stops "left" appearing always. */
  { name: 'غرفة عائلية', left: null },
];

/* The customer app, like every other customer spec — the shared default is the console. */
test.use({ baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 1000 } });

test('thirteen rooms read as four choices, each with its own terms', async ({ page }) => {
  await page.goto(`/ar/property/${SLUG}`, { waitUntil: 'domcontentloaded' });

  const units = page.locator('#units');

  await expect(units).toBeVisible({ timeout: 20_000 });

  /*
    Rows, not units. Six identical doubles collapsing to one row is the whole point: before
    grouping, a guest met six indistinguishable «غرفة مزدوجة قياسية» and picked one at random.
  */
  /* Direct children only: the amenity chips inside a row are `li` too. */
  const rows = units.locator('> ul > li');

  await expect(rows, 'four types, not thirteen rooms').toHaveCount(TYPES.length);

  for (const type of TYPES) {
    const row = rows.filter({ hasText: type.name });

    await expect(row, `${type.name} is offered`).toHaveCount(1);

    if (type.left) {
      await expect(row, `${type.name} says how many are left`).toContainText(type.left);
    } else {
      await expect(row, 'a one-of-a-kind room claims no remainder').not.toContainText(
        'متبقية',
      );
    }
  }

  /* Each choice states what it costs, who it sleeps, and what it needs. */
  const suite = rows.filter({ hasText: 'جناح تنفيذي' });

  /*
    186.99 — the suite's 185 with SAFRA's 1.99 fee already in it, which is how every price on the
    customer side is stated. Asserting the bare base rate would have been asserting a figure no
    guest is ever shown.
  */
  await expect(suite, 'the suite is priced as itself').toContainText('186.99');
  await expect(suite, 'and sleeps four').toContainText('4');
  await expect(suite, 'its own facilities').toContainText('مطبخ');
  await expect(suite, 'and its minimum stay').toContainText('ليلتان');

  const standard = rows.filter({ hasText: 'غرفة مزدوجة قياسية' });

  await expect(standard, 'the standard double is cheaper').toContainText('73.99');
  await expect(standard, 'and has no kitchen').not.toContainText('مطبخ');

  /* The building's facilities are the building's, on every row and none. */
  await expect(units, 'the pool belongs to the hotel, not a room').not.toContainText(
    'مسبح',
  );
  await expect(page.getByRole('heading', { name: 'مرافق العقار' })).toBeVisible();

  await page.screenshot({ path: 'test-results/multi-unit-hotel.png', fullPage: true });
});

test('the room a guest chooses is the room checkout quotes', async ({ page }) => {
  await page.goto(`/ar/property/${SLUG}`, { waitUntil: 'domcontentloaded' });

  const suite = page.locator('#units > ul > li').filter({ hasText: 'جناح تنفيذي' });
  const book = suite.getByRole('link', { name: 'احجز هذه الوحدة' });

  const href = (await book.getAttribute('href')) ?? '';

  /*
    The link carries a specific PHYSICAL room, not a type. Booking targets one `unit_id` because
    the exclusion constraint does, and the grouping above is a display concern only.
  */
  expect(href, 'the choice travels as a unit id').toMatch(/unitId=[0-9a-f-]{36}/);

  await book.click();
  await page.waitForURL(/\/checkout\?/);

  const main = page.locator('main');

  await expect(main, 'checkout quotes the suite the guest picked').toContainText(
    'جناح تنفيذي',
    { timeout: 20_000 },
  );
  /*
    371.99 — two nights at 185 plus the 1.99 fee. TWO because the suite's minimum is two nights and
    the link now extends the window to satisfy it: the page's default stay is built from the
    CHEAPEST room's one-night minimum, so a suite link carrying it was born asking for a stay the
    suite forbids — and `quote` priced it anyway, so the guest reached a checkout the booking would
    refuse. Both halves were fixed on 2026-09-06.
  */
  await expect(main, 'at the suite’s price, for a stay it accepts').toContainText(
    '371.99',
  );
  await expect(main, 'and the two nights its minimum requires').toContainText('ليلتين');
  await expect(main, 'and not some other room').not.toContainText('غرفة مزدوجة قياسية');

  console.log('--- CHECKOUT ---\n' + (await main.innerText()).slice(0, 380));
});

test('the moderator reviews the same four types', async ({ browser }) => {
  test.skip(MISSING_CREDENTIALS, SKIP_REASON);

  const staff = await browser.newContext({ storageState: STAFF_STATE });
  const page = await staff.newPage();

  try {
    await page.goto(`http://localhost:3001/properties/${PROPERTY}`, {
      waitUntil: 'domcontentloaded',
    });

    const main = page.locator('main');

    /*
      The console lists PHYSICAL rooms rather than types, deliberately: a moderator approving a
      hotel is approving thirteen rooms, and a reviewer who saw four would not know how many were
      being published.
    */
    await expect(main, 'the reviewer sees the rooms').toContainText('جناح تنفيذي', {
      timeout: 20_000,
    });
    await expect(main, 'with their facilities').toContainText('مطبخ');
    await expect(main, 'and the building’s own').toContainText('مرافق العقار');
  } finally {
    await staff.close();
  }
});
