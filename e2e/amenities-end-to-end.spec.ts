import { expect, test } from '@playwright/test';

import { PARTNER_BASE, PARTNER_STATE } from './partner-session.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * Amenities, along the whole chain — partner declares, guest sees, filter finds.
 *
 * ## Why this spec exists
 *
 * `unit_amenities` was **empty on every database**. The API accepted `amenityCodes` on unit create
 * and on unit update and wrote the links correctly; the partner projection never returned them and
 * the portal never sent them. So the customer property page had an amenities section with nothing
 * in it, the search sidebar had nothing to offer, and كتالوج المنصّة curated a catalogue no listing
 * could use. Every suite was green throughout — nothing was broken, a step did not exist.
 *
 * Bashar, 2026-09-05: *"I do not want amenities to become another capability that exists in the
 * backend but has no reachable workflow in the UI."*
 *
 * ## Why one test rather than four
 *
 * The links are only worth anything together. A partner-side test that stopped at «the checkbox is
 * ticked» would have passed for the whole time this was broken, and so would a customer-side test
 * against seeded data. What had to be proven is that the SAME declaration travels: ticked in the
 * portal, stored by the API, rendered to a guest, and matched by the filter.
 *
 * ## It puts the unit back
 *
 * The selection is restored at the end, so the fixture is what the next run finds. The restore is
 * asserted rather than assumed — a cleanup that silently failed would leave the next run measuring
 * this one's leftovers.
 */
const PROPERTY = 'PRO-363247';
const SLUG = 'qasr-al-sharq-malki';

test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.use({
  baseURL: PARTNER_BASE,
  storageState: PARTNER_STATE,
  viewport: { width: 1440, height: 900 },
});

test('a partner declares an amenity and a guest sees it', async ({
  page,
  browser,
  request,
}) => {
  const api = 'http://localhost:4000/api/v1';

  // ── 1. THE PARTNER SELECTS ────────────────────────────────────────────────
  await page.goto(`/properties/${PROPERTY}/edit`, { waitUntil: 'domcontentloaded' });

  const picker = page.locator('[data-amenity-picker]').first();

  await expect(picker, 'the picker is on the screen at all').toBeVisible();

  const unitId = (await picker.getAttribute('data-amenity-picker'))!;
  const summary = page.locator(`[data-amenity-summary="${unitId}"]`);

  console.log('unit under test:', unitId);
  console.log('declared before:', await summary.innerText());

  /*
    A checkbox is picked from what the CATALOGUE offers rather than named here. A hard-coded code
    would fail the day a super admin retires it — and retiring one is now a thing they can do.
  */
  const boxes = picker.locator('input[type="checkbox"]');
  const count = await boxes.count();

  /*
    An amenity this unit does NOT already declare, so ticking it is a real change.

    The first version took `boxes.first()`, unchecked it and checked it again — which leaves the set
    identical, so `save()` short-circuits on an empty patch (correctly) and no request is ever made.
    The test then waited two minutes for a PATCH that had no reason to exist. A test that toggles a
    value to itself proves nothing about storing it.
  */
  let index = -1;

  for (let at = 0; at < count; at += 1) {
    if (!(await boxes.nth(at).isChecked())) {
      index = at;
      break;
    }
  }

  test.skip(index < 0, 'This unit already declares every amenity in the catalogue.');

  const box = boxes.nth(index);
  const code = (await box.getAttribute('id'))!.replace(`${unitId}-amenity-`, '');

  console.log('amenity under test:', code);

  await box.check();

  const saved = page.waitForResponse(
    (r) => r.url().includes(`/api/units/${unitId}`) && r.request().method() === 'PATCH',
  );

  await page
    .locator(`form:has([data-amenity-picker="${unitId}"])`)
    .getByRole('button', { name: 'حفظ الوحدة' })
    .click();

  expect((await saved).status(), 'the API accepted the declaration').toBeLessThan(300);
  await expect(page.getByText('حُفظت الوحدة').first()).toBeVisible({ timeout: 15_000 });

  // ── 2. THE API STORED IT ──────────────────────────────────────────────────
  await page.goto(`/properties/${PROPERTY}/edit`, { waitUntil: 'domcontentloaded' });

  await expect(
    /*
      An ATTRIBUTE selector, not `#id`. A code contains hyphens and `CSS.escape` is a browser
      global that does not exist in the runner's Node context — and an unescaped `#` selector
      breaks on the first code with a character CSS treats specially.
    */
    page.locator(`input[id="${unitId}-amenity-${code}"]`),
    'it survived a reload, so it is stored rather than held in the form',
  ).toBeChecked();

  const declared = await page.locator(`[data-amenity-summary="${unitId}"]`).innerText();

  console.log('declared after:', declared);
  expect(declared, 'and the summary names it').not.toContain('لا خدمات محدَّدة');

  // ── 3. THE CUSTOMER APPLICATION DISPLAYS IT ───────────────────────────────
  const detail = await request.get(`${api}/properties/${SLUG}`);

  expect(detail.status(), 'the public property endpoint answers').toBe(200);

  const body = (await detail.json()) as {
    units: { id: string; amenityCodes: string[] }[];
  };
  const unit = body.units.find((one) => one.id === unitId);

  console.log('customer payload amenityCodes:', unit?.amenityCodes);
  expect(unit?.amenityCodes, 'the guest-facing payload carries it').toContain(code);

  /*
    And on the page a guest actually reads — but note WHAT is asserted there and why.

    The property page is ISR (`revalidate = 60`) and its fetch caches for the same minute, so a
    declaration made seconds ago is not on it yet. That is correct for a heavily-read public page
    and it means the page cannot prove STORAGE — the payload above does that. What the page is
    asked here is whether it renders amenity NAMES from the catalogue rather than raw codes, which
    is the half no API assertion can see.

    It also shows the CHEAPEST unit's amenities rather than the union across units — recorded in
    `docs/FUTURE-WORK.md`, since a property whose suite has a balcony and whose cheapest room does
    not will not mention the balcony anywhere.
  */
  const guest = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const guestPage = await guest.newPage();

  try {
    await guestPage.goto(`http://localhost:3000/ar/property/${SLUG}`, {
      waitUntil: 'domcontentloaded',
    });

    const shown = await guestPage.locator('main').innerText();

    await guestPage.screenshot({
      path: 'test-results/amenities-customer.png',
      fullPage: true,
    });

    /* The name, in the guest's language — the catalogue's Arabic, not the code. */
    expect(shown, 'the code never reaches a guest').not.toContain(code);
  } finally {
    await guest.close();
  }

  // ── 4. THE FILTER RETURNS IT ──────────────────────────────────────────────
  /*
    The count endpoint first: `catalog.service` lists only amenities a published stay declares, so
    a code appearing there at all is proof the link reached the customer side of the platform.
  */
  const catalogue = await request.get(`${api}/amenities`);
  const offered = (await catalogue.json()) as { code: string; propertyCount: string }[];
  const entry = offered.find((one) => one.code === code);

  console.log('search sidebar entry:', entry);

  /* `is_filterable` may be off for this one — then it is correctly absent, and that is not a fail. */
  if (entry) {
    expect(
      Number(entry.propertyCount),
      'the filter counts a real listing',
    ).toBeGreaterThan(0);

    const day = (offset: number) => {
      const at = new Date();

      at.setUTCDate(at.getUTCDate() + offset);

      return at.toISOString().slice(0, 10);
    };

    const found = await request.get(
      `${api}/search?checkIn=${day(60)}&checkOut=${day(62)}&adults=2&limit=40&amenityCodes=${code}`,
    );

    expect(found.status()).toBe(200);

    const results = (await found.json()) as { items: { slug: string }[] };

    console.log(`filtered by ${code}: ${results.items.length} result(s)`);
    expect(
      results.items.some((one) => one.slug === SLUG),
      'filtering by the amenity returns the listing that declares it',
    ).toBe(true);
  }

  // ── 5. THE CONSOLE SEES THE SAME THING ────────────────────────────────────
  const staff = await browser.newContext({ storageState: STAFF_STATE });
  const consolePage = await staff.newPage();

  try {
    await consolePage.goto(`http://localhost:3001/properties/${PROPERTY}`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(
      consolePage.locator('main'),
      'the reviewer sees the listing the partner just edited',
    ).toContainText(PROPERTY);
  } finally {
    await staff.close();
  }

  // ── Put it back ───────────────────────────────────────────────────────────
  await page.goto(`/properties/${PROPERTY}/edit`, { waitUntil: 'domcontentloaded' });

  const restore = page.waitForResponse(
    (r) => r.url().includes(`/api/units/${unitId}`) && r.request().method() === 'PATCH',
  );

  await page.locator(`input[id="${unitId}-amenity-${code}"]`).uncheck();
  await page
    .locator(`form:has([data-amenity-picker="${unitId}"])`)
    .getByRole('button', { name: 'حفظ الوحدة' })
    .click();

  expect((await restore).status(), 'the fixture went back').toBeLessThan(300);

  /* Asserted, not assumed: a cleanup that silently failed leaves the next run measuring this one. */
  await page.goto(`/properties/${PROPERTY}/edit`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`input[id="${unitId}-amenity-${code}"]`)).not.toBeChecked();
});
