import { expect, test } from '@playwright/test';

import { PARTNER_BASE, PARTNER_STATE } from './partner-session.js';
import { requirePublishedReference } from './partner-fixtures.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * Amenities at TWO levels, along the whole chain.
 *
 * The sibling spec beside this one proves a UNIT's amenities travel. This proves the distinction
 * Bashar asked for on 2026-09-06: a pool belongs to the building and a kettle to the room, and a
 * guest has to be able to tell which is which. Before it there was only the unit level, so a
 * hotel's pool had to be repeated on every room to be visible at all — and a guest reading it could
 * not tell whether it was theirs.
 *
 * ## What is proven, in order
 *
 * The partner ticks a facility on the PROPERTY; the API stores it against the property and against
 * no unit; the guest sees it under «مرافق العقار» and NOT among the rooms; the moderator sees it
 * while reviewing; and the search filter finds the property by a code held only at the property
 * level — which the old unit-only filter could not have matched.
 *
 * ## It normalises before it asserts
 *
 * `setFacilities` drives the boxes to a stated set and only waits for a request when something
 * actually changed, because the save button is correctly disabled when nothing has. An earlier
 * version assumed a clean fixture and hung for the full timeout on a working build the first time
 * a previous run left the boxes ticked.
 */
/* Resolved per run: a reseed renumbers references — see property-reference.ts. */
let PROPERTY = '';
const SLUG = 'qasr-al-sharq-malki';

/** Unmistakably the building's, and absent from this fixture's unit lists. */
const PROPERTY_LEVEL = ['pool', 'parking'];

test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.use({
  baseURL: PARTNER_BASE,
  storageState: PARTNER_STATE,
  viewport: { width: 1440, height: 900 },
});

/* After `test.use`, so the hook runs with the fixtures this file configures. */
test.beforeAll(async ({ request }) => {
  PROPERTY = await requirePublishedReference(request, SLUG);
});

test('a facility declared on the property reaches every surface as the property’s', async ({
  page,
  browser,
  request,
}) => {
  const api = 'http://localhost:4000/api/v1';

  async function setFacilities(want: readonly string[]): Promise<void> {
    await page.goto(`/properties/${PROPERTY}/edit`, { waitUntil: 'domcontentloaded' });

    const picker = page.locator('[data-amenity-picker="property-amenity"]');

    await expect(picker, 'the property has facilities of its own').toBeVisible({
      timeout: 15_000,
    });

    for (const code of PROPERTY_LEVEL) {
      const box = picker.locator(`input[id="property-amenity-amenity-${code}"]`);

      await expect(box, `${code} is offered`).toBeVisible();

      const shouldBe = want.includes(code);

      if ((await box.isChecked()) !== shouldBe) {
        if (shouldBe) await box.check();
        else await box.uncheck();
      }
    }

    const save = page.locator('[data-property-amenities-save]');

    /* Nothing changed, so there is nothing to send — and no response to wait for. */
    if (await save.isDisabled()) return;

    const done = page.waitForResponse(
      (r) =>
        r.url().includes(`/properties/${PROPERTY}`) && r.request().method() === 'PATCH',
    );

    await save.click();
    expect((await done).status(), 'the property saved').toBeLessThan(300);
  }

  // ── 1. THE PARTNER declares it ────────────────────────────────────────────
  /* From nothing, so the write is exercised however the last run left things. */
  await setFacilities([]);
  await setFacilities(PROPERTY_LEVEL);

  // ── 2. THE API stored it on the PROPERTY, and on no unit ──────────────────
  const detail = await request.get(`${api}/properties/${SLUG}`);

  expect(detail.status()).toBe(200);

  const body = (await detail.json()) as {
    amenityCodes: string[];
    units: { amenityCodes: string[] }[];
  };

  console.log('property amenities:', body.amenityCodes);
  console.log('unit amenities:', JSON.stringify(body.units.map((u) => u.amenityCodes)));

  for (const code of PROPERTY_LEVEL) {
    expect(body.amenityCodes, `${code} is the property's`).toContain(code);
    for (const unit of body.units) {
      expect(unit.amenityCodes, `${code} did not leak onto a unit`).not.toContain(code);
    }
  }

  // ── 3. THE GUEST sees the two levels, apart ───────────────────────────────
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();

  try {
    await guestPage.goto(`http://localhost:3000/ar/property/${SLUG}`, {
      waitUntil: 'domcontentloaded',
    });

    /*
      Reloaded until it appears, because the guest page is CACHED for a minute.

      A property's description, photographs and facilities are revalidated every 60s — right for
      content that changes rarely, and it means a facility a partner ticks reaches guests within a
      minute rather than instantly. That window is deliberate product behaviour, so the spec waits
      it out rather than asserting the platform is broken. (Availability is exempt and always live;
      see `getProperty` — a stale room count is a different kind of wrong.)
    */
    const heading = guestPage.getByRole('heading', { name: 'مرافق العقار' });

    for (let attempt = 0; attempt < 14; attempt += 1) {
      if (await heading.isVisible().catch(() => false)) break;

      await guestPage.waitForTimeout(5_000);
      await guestPage.reload({ waitUntil: 'domcontentloaded' });
    }

    await expect(heading, 'the building has a section of its own').toBeVisible({
      timeout: 20_000,
    });

    /*
      Scoped to the section. Asserting on the whole document would pass on a build that listed the
      pool among a ROOM's facilities, which is the exact confusion this separation removes.
    */
    const propertySection = guestPage
      .locator('section:has(h2:text-is("مرافق العقار"))')
      .first();

    await expect(propertySection).toContainText('مسبح');
    await expect(propertySection).toContainText('موقف سيارات');

    /* The rooms are a list the guest chooses from, and the pool is not in it. */
    const units = guestPage.locator('#units');

    await expect(units, 'the rooms are on the page').toBeVisible();
    await expect(
      /* A BUTTON since the rows became a choice rather than a link off the page. */
      units.getByRole('button', { name: 'احجز هذه الوحدة' }).first(),
      'each room can be chosen on its own',
    ).toBeVisible();
    await expect(units, 'the building’s pool is not a room’s').not.toContainText('مسبح');

    console.log('--- UNITS ---\n' + (await units.innerText()).slice(0, 420));
    await guestPage.screenshot({
      path: 'test-results/property-units.png',
      fullPage: true,
    });
  } finally {
    await guest.close();
  }

  // ── 4. THE MODERATOR sees both levels ─────────────────────────────────────
  const staff = await browser.newContext({ storageState: STAFF_STATE });
  const consolePage = await staff.newPage();

  try {
    await consolePage.goto(`http://localhost:3001/properties/${PROPERTY}`, {
      waitUntil: 'domcontentloaded',
    });

    const main = consolePage.locator('main');

    await expect(main, 'the reviewer reads the property level').toContainText(
      'مرافق العقار',
      { timeout: 20_000 },
    );
    await expect(main).toContainText('مسبح');
  } finally {
    await staff.close();
  }

  // ── 5. THE FILTER finds it by a PROPERTY-level code ────────────────────────
  const filtered = await request.get(
    `${api}/search?checkIn=2026-09-17&checkOut=2026-09-19&adults=2&amenityCodes=pool&limit=50`,
  );

  expect(filtered.status()).toBe(200);

  const found = (await filtered.json()) as { items: { slug: string }[] };

  console.log(`filtered by pool: ${found.items.length} result(s)`);
  expect(
    found.items.some((one) => one.slug === SLUG),
    'a property-level facility satisfies the filter that asks for it',
  ).toBe(true);

  // ── Put it back ───────────────────────────────────────────────────────────
  await setFacilities([]);
});
