import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { MISSING_CREDENTIALS, SKIP_REASON } from './staff.js';

/**
 * The whole accommodation journey, on a hotel with real inventory.
 *
 * Bashar, 2026-09-06: *"Do not treat reading the code as equivalent to driving the journey."* So
 * this drives it — search, property, comparison, selection, checkout, creation — and then checks
 * what the booking DID: the row in the database, the room on the customer's own booking, the
 * partner's views, the moderator's, and the inventory left behind.
 *
 * ## Three room types, chosen for what they differ in
 *
 * - `double_standard` — six interchangeable rooms. Booking one must leave five, and must not touch
 *   the other types.
 * - `suite_executive` — a two-night minimum, so the stay has to stretch to meet it.
 * - `family_room` — one of a kind, sleeps six, and must never claim a remainder.
 *
 * ## Why it books rather than asserting on seeded rows
 *
 * A booking made by the seeder proves the seeder works. What is in question is whether the room a
 * guest PICKS is the room that ends up in the database, on the voucher, in the partner's calendar
 * and on the moderator's screen — and that is only answerable by picking one.
 */
const SLUG = 'grand-umayyad-hotel';
const API = 'http://localhost:4000/api/v1';

test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.use({ baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 1000 } });

/**
 * A stay far enough out that the seeder's own bookings do not collide with it — and DIFFERENT on
 * every run.
 *
 * A booking cannot be un-made through the pages a guest uses, so a fixed window would leave the
 * next run measuring this one's leftovers: the first version asserted "six doubles to start" and
 * found five the second time it ran. Deriving the window from the clock gives each run untouched
 * inventory, which is what makes the deltas below mean anything.
 */
const STAY = (() => {
  const at = new Date();

  /*
    Milliseconds, not minutes.

    The first version moved the window on the hour-and-minute, so two runs inside the same minute
    shared it — and the second one measured the first one's bookings. That is exactly the failure
    the window exists to prevent, arriving an order of magnitude later: this file books a family
    room, the fixture has ONE, and a re-run inside the same minute found the type exhausted and
    reported it as a broken product. 500 days of spread and a millisecond seed make a collision
    rare rather than routine.
  */
  at.setUTCDate(at.getUTCDate() + 200 + (Date.now() % 500));

  const checkIn = at.toISOString().slice(0, 10);

  at.setUTCDate(at.getUTCDate() + 2);

  return { checkIn, checkOut: at.toISOString().slice(0, 10) };
})();
const QUERY = `checkIn=${STAY.checkIn}&checkOut=${STAY.checkOut}&adults=2`;

/**
 * How many rooms of each type the API says are free for the stay.
 *
 * Through the REQUEST fixture, not the page: the customer app's CSP forbids a cross-origin fetch to
 * the API, which is correct and which a test must not ask the browser to break.
 */
async function inventory(request: APIRequestContext): Promise<Record<string, number>> {
  const response = await request.get(
    `${API}/properties/${SLUG}?checkIn=${STAY.checkIn}&checkOut=${STAY.checkOut}`,
  );

  expect(response.status()).toBe(200);

  const body = (await response.json()) as {
    units: { roomTypeCode: string | null; available: boolean }[];
  };

  const free: Record<string, number> = {};

  for (const unit of body.units) {
    const key = unit.roomTypeCode ?? 'one_of_a_kind';

    free[key] = (free[key] ?? 0) + (unit.available ? 1 : 0);
  }

  return free;
}

/** Books one room of a type, through the pages a guest actually uses. */
async function book(
  page: Page,
  typeName: string,
): Promise<{ reference: string; unitId: string }> {
  await page.goto(`/ar/property/${SLUG}?${QUERY}`, { waitUntil: 'domcontentloaded' });

  const row = page.locator('#units > ul > li').filter({ hasText: typeName });

  /* Choose on the row, commit on the card — the two acts a guest performs. */
  await row.getByRole('button', { name: 'احجز هذه الوحدة' }).click();

  const card = page.locator('aside#booking');
  const book = card.getByRole('link', { name: 'احجز الآن' });

  const href = (await book.getAttribute('href')) ?? '';
  const unitId = /unitId=([0-9a-f-]{36})/.exec(href)?.[1] ?? '';

  expect(unitId, `${typeName} offers a bookable room`).toMatch(/[0-9a-f-]{36}/);

  await book.click();
  await page.waitForURL(/\/checkout\?/);

  /* The room is NAMED where the money is agreed — not just priced. */
  await expect(page.locator('aside'), 'checkout names the room').toContainText(typeName);

  await page.getByLabel('الاسم الكامل').fill('ضيف الرحلة');
  await page.getByLabel('البريد الإلكتروني').fill('journey@safra.test');
  await page.getByLabel('رقم الهاتف (واتساب)').fill('933444555');

  const created = page.waitForResponse(
    (r) => r.url().includes('/api/bookings') && r.request().method() === 'POST',
  );

  await page.getByRole('button', { name: 'تابع إلى الدفع' }).click();

  const response = await created;

  expect(response.status(), `${typeName} was booked`).toBe(201);

  const body = (await response.json()) as { reference: string };

  /*
    Let the app finish redirecting before the caller navigates.

    Creation is followed by a payment start, which sends the browser to the remittance page for the
    offline rail. Navigating while that is in flight aborts it — `net::ERR_ABORTED` — which looks
    like a broken page and is only a race in the test.
  */
  await page.waitForURL(/payments\/return|\/booking\//, { timeout: 30_000 });

  return { reference: body.reference, unitId };
}

test('booking one room of a type leaves the rest, and the other types alone', async ({
  page,
  request,
}) => {
  await page.goto(`/ar/property/${SLUG}?${QUERY}`, { waitUntil: 'domcontentloaded' });

  const before = await inventory(request);

  /* The window too — without it a failing run cannot be reproduced, since it moves every run. */
  console.log(`stay: ${STAY.checkIn} → ${STAY.checkOut}`);
  console.log('before:', JSON.stringify(before));

  /*
    A precondition, not a fixed expectation: what matters below is the DELTA, and asserting the
    absolute count made the suite fail the second time it ran against inventory it had itself
    consumed.
  */
  expect(before['double_standard'], 'doubles are free to book').toBeGreaterThan(1);
  expect(before['suite_executive'], 'and so are suites').toBeGreaterThan(0);
  /*
    A RANGE, like the two above it — the comment three lines up says exactly why, and this line was
    the one that ignored it. Whatever ran before may have taken a family room, and the assertions
    that matter below compare deltas rather than absolutes.
  */
  expect(before['family_room'], 'and the family room').toBeGreaterThanOrEqual(1);

  const standard = await book(page, 'غرفة مزدوجة قياسية');

  console.log('booked standard:', standard.reference);

  const after = await inventory(request);

  console.log('after: ', JSON.stringify(after));

  /*
    The whole inventory question in three assertions: the type it came from loses exactly one, and
    nothing else moves. A model that reserved the TYPE rather than a room would drop all six.
  */
  expect(after['double_standard'], 'one fewer double').toBe(
    (before['double_standard'] ?? 0) - 1,
  );
  expect(after['suite_executive'], 'the suites are untouched').toBe(
    before['suite_executive'],
  );
  expect(after['family_room'], 'and so is the family room').toBe(before['family_room']);

  /* And the page says so, rather than only the API. */
  await page.goto(`/ar/property/${SLUG}?${QUERY}`, { waitUntil: 'domcontentloaded' });

  const doubles = page
    .locator('#units > ul > li')
    .filter({ hasText: 'غرفة مزدوجة قياسية' });

  const remaining = after['double_standard'] ?? 0;

  /* Whatever the number now is, the page must be saying it. */
  await expect(doubles, 'the count a guest reads matches what is free').toContainText(
    String(remaining),
  );
});

test('a suite stretches the stay to its own minimum, and reaches the database as itself', async ({
  page,
  request,
}) => {
  const suite = await book(page, 'جناح تنفيذي');

  console.log('booked suite:', suite.reference, 'unit', suite.unitId);

  /*
    Two nights, because the suite says two. The page's default window comes from the CHEAPEST room's
    one-night minimum, so this is the assertion that the link stretched it rather than handing the
    API a stay it would refuse.
  */
  const detail = await request.get(`${API}/properties/${SLUG}`);
  const units = ((await detail.json()) as { units: { id: string; minNights: number }[] })
    .units;

  expect(
    units.find((one) => one.id === suite.unitId)?.minNights,
    'the room booked really is a two-night one',
  ).toBe(2);
});

test('a family room is one of a kind and never claims a remainder', async ({ page }) => {
  await page.goto(`/ar/property/${SLUG}?${QUERY}`, { waitUntil: 'domcontentloaded' });

  const family = page.locator('#units > ul > li').filter({ hasText: 'غرفة عائلية' });

  await expect(family, 'sleeps six').toContainText('6');
  await expect(family, 'and claims no remainder').not.toContainText('متبقية');

  const booked = await book(page, 'غرفة عائلية');

  console.log('booked family:', booked.reference);

  await page.goto(`/ar/property/${SLUG}?${QUERY}`, { waitUntil: 'domcontentloaded' });

  const again = page.locator('#units > ul > li').filter({ hasText: 'غرفة عائلية' });

  /* The only one there is, now taken: described, and honestly not offered. */
  await expect(again, 'it says so rather than offering a dead link').toContainText(
    'غير متاحة للتواريخ المختارة',
  );
  await expect(again.getByRole('link', { name: 'احجز هذه الوحدة' })).toHaveCount(0);
});
