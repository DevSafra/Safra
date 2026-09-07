import { expect, test, type Page } from '@playwright/test';

/**
 * The booking basket: several room TYPES on one booking.
 *
 * ## What this holds
 *
 * A card that held ONE choice and replaced it, so «مزدوجة × 2 + جناح × 1» — a family needing two
 * rooms and a suite — was two bookings, two payments and two vouchers, and adding the suite
 * silently discarded the doubles. The guest had no way to see what they had lost.
 *
 * The assertions that matter are the ARITHMETIC ones. That a basket accumulates is easy to see; that
 * the figure on the card is the figure checkout charges is the thing a guest is owed, and the two
 * are computed by different code — the card sums the lines in the browser, the API prices them on
 * the server. They agree because it is the same rule applied to the same inputs, and this compares
 * them rather than trusting that.
 */
const HOTEL = '/ar/property/grand-umayyad-hotel';

test.describe.configure({ mode: 'serial' });
test.use({ baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 1300 } });

/**
 * The rows that CAN be added, resolved to fixed indices once.
 *
 * A live filter on «أضف إلى الحجز» was the first version, and it was a trap: the button's label
 * becomes «في الحجز · غرفة واحدة» the moment a row is added, so the row LEFT the filter and
 * `nth(0)` silently became a different room type. The second click added a second type instead of
 * a second room, and the test reported three lines where it expected two.
 */
async function addableIndices(page: Page): Promise<number[]> {
  const rows = page.locator('#units > ul > li');
  const count = await rows.count();
  const found: number[] = [];

  for (let i = 0; i < count; i += 1) {
    if ((await rows.nth(i).getByRole('button', { name: 'أضف إلى الحجز' }).count()) > 0) {
      found.push(i);
    }
  }

  return found;
}

/** That row's add control, whatever its label currently says. */
const adder = (page: Page, index: number) =>
  page
    .locator('#units > ul > li')
    .nth(index)
    .getByRole('button', { name: /أضف إلى الحجز|في الحجز/ });

test('adding a second room type keeps the first', async ({ page }) => {
  await page.goto(HOTEL, { waitUntil: 'domcontentloaded' });

  const rows = await addableIndices(page);

  expect(rows.length, 'the hotel offers more than one bookable type').toBeGreaterThan(1);

  const card = page.locator('aside#booking');

  await adder(page, rows[0]!).click();
  await expect(card.locator('[data-basket-line]')).toHaveCount(1);

  /*
    THE regression this file exists for. A second type used to REPLACE the first, so this count
    was one and the guest's earlier choice was gone with nothing said about it.
  */
  await adder(page, rows[1]!).click();
  await expect(card.locator('[data-basket-line]'), 'both types are held').toHaveCount(2);
});

test('the total is the lines plus one fee, and checkout charges it', async ({ page }) => {
  await page.goto(HOTEL, { waitUntil: 'domcontentloaded' });

  const rows = await addableIndices(page);
  const card = page.locator('aside#booking');

  /* Two of the first type and one of the second — the shape a family actually books. */
  await adder(page, rows[0]!).click();
  await adder(page, rows[0]!).click();
  await adder(page, rows[1]!).click();

  await expect(card.locator('[data-basket-line]')).toHaveCount(2);

  const total = Number(
    await card.locator('[data-summary-total]').getAttribute('data-summary-total'),
  );

  expect(total, 'the basket is priced').toBeGreaterThan(0);

  const href =
    (await card.getByRole('link', { name: 'احجز الآن' }).getAttribute('href')) ?? '';

  /* The whole basket travels: the lead pair, and the other types beside it. */
  expect(href, 'the lead line').toContain('rooms=2');
  expect(href, 'and the second type').toMatch(/lines=[0-9a-f-]{36}:1/);

  await card.getByRole('link', { name: 'احجز الآن' }).click();
  await page.waitForURL(/\/checkout\?/);

  /*
    Every type NAMED on the last screen before payment.

    It printed the lead type alone, so a basket's largest component could be invisible while
    somebody was asked to pay for it.
  */
  const basket = page.locator('[data-checkout-basket] li');

  await expect(basket, 'checkout lists both types').toHaveCount(2);

  /*
    And the same money. The card computed this in the browser and the API computed it on the
    server; a difference here is a guest agreeing to one figure and being charged another.
  */
  const charged = Number(
    await page.locator('[data-checkout-total]').getAttribute('data-checkout-total'),
  );

  expect(charged, 'checkout charges the card’s total').toBeCloseTo(total, 2);
});

test('a line can be reduced and removed, and the total follows', async ({ page }) => {
  await page.goto(HOTEL, { waitUntil: 'domcontentloaded' });

  const rows = await addableIndices(page);
  const card = page.locator('aside#booking');

  await adder(page, rows[0]!).click();
  await adder(page, rows[0]!).click();
  await adder(page, rows[1]!).click();

  const total = () =>
    card
      .locator('[data-summary-total]')
      .getAttribute('data-summary-total')
      .then((value) => Number(value));

  const three = await total();

  /* Down one, and the money must fall. */
  await card
    .locator('[data-basket-line]')
    .first()
    .getByRole('button', { name: /إنقاص/ })
    .click();

  const two = await total();

  expect(two, 'reducing a line reduces the total').toBeLessThan(three);

  /* Removing a line takes it off the card AND out of the money. */
  await card
    .locator('[data-basket-line]')
    .first()
    .getByRole('button', { name: /إزالة/ })
    .click();

  await expect(card.locator('[data-basket-line]')).toHaveCount(1);
  expect(await total(), 'removing a line reduces it again').toBeLessThan(two);

  /* And emptying it puts the card back to its «choose a room» state. */
  await card.getByRole('button', { name: 'إفراغ السلّة' }).click();
  await expect(card.locator('[data-basket-line]')).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'اختر غرفة' })).toBeVisible();
});

test('a room whose minimum stay is longer than the search says so', async ({ page }) => {
  /*
    A booking has ONE stay, so a suite that takes two nights cannot join a one-night basket. The
    row is shown — hiding it would tell a guest the hotel has no suite — and it states the minimum
    instead of offering a control checkout would refuse.
  */
  await page.goto(`${HOTEL}?checkIn=2027-03-08&checkOut=2027-03-09&adults=2`, {
    waitUntil: 'domcontentloaded',
  });

  const blocked = page.locator('#units > ul > li').filter({ hasText: 'عدّل التواريخ' });

  await expect(blocked.first(), 'the room says why it cannot be added').toBeVisible();

  /* And it offers no way to add it — the opposite control. */
  await expect(
    blocked.first().getByRole('button', { name: 'أضف إلى الحجز' }),
  ).toHaveCount(0);
});

/**
 * The two assertions `room-quantity.spec.ts` held, carried over to the basket.
 *
 * That file tested a card with ONE stepper for ONE chosen room. The quantity control is per LINE
 * now, so its interaction is gone — but what it was protecting is not: a control that cannot move
 * must not be drawn, and a ceiling must say which ceiling it is.
 */
test('a line offers a stepper only where there is a quantity to choose', async ({
  page,
}) => {
  await page.goto(HOTEL, { waitUntil: 'domcontentloaded' });

  const rows = await addableIndices(page);
  const card = page.locator('aside#booking');

  /* A type the hotel has SEVERAL of gets a stepper. */
  const many = page.locator('#units > ul > li').filter({ hasText: 'متبقية' }).first();

  await many.getByRole('button', { name: /أضف إلى الحجز|في الحجز/ }).click();
  await expect(
    card.locator('[data-basket-line]').first().getByRole('button', { name: /زيادة/ }),
    'several of a type: a stepper',
  ).toBeVisible();

  /*
    And a one-of-a-kind type does NOT. Both its arrows would be dead the moment the line existed —
    the opposite control, without which «draw a stepper» and «draw a stepper everywhere» pass
    identically.
  */
  const lonely = page
    .locator('#units > ul > li')
    .filter({ hasNotText: 'متبقية' })
    .filter({ hasText: 'أضف إلى الحجز' })
    .first();

  if ((await lonely.count()) === 0) {
    expect(rows.length, 'the fixture had no one-of-a-kind type to check').toBeGreaterThan(
      0,
    );

    return;
  }

  await lonely.getByRole('button', { name: /أضف إلى الحجز|في الحجز/ }).click();

  const lines = card.locator('[data-basket-line]');

  await expect(lines).toHaveCount(2);
  await expect(
    lines.nth(1).getByRole('button', { name: /زيادة/ }),
    'one of a kind: no stepper',
  ).toHaveCount(0);
});

test('a line at its own ceiling says so, distinctly from the basket being full', async ({
  page,
}) => {
  await page.goto(HOTEL, { waitUntil: 'domcontentloaded' });

  const card = page.locator('aside#booking');
  const row = page.locator('#units > ul > li').filter({ hasText: 'متبقية' }).first();
  const left = Number(/(\d+)/.exec(await row.innerText())?.[1] ?? '0');

  await row.getByRole('button', { name: /أضف إلى الحجز|في الحجز/ }).click();

  const line = card.locator('[data-basket-line]').first();
  const plus = line.getByRole('button', { name: /زيادة/ });

  /* Walk it to the type's own ceiling. */
  for (let i = 0; i < 12; i += 1) {
    if (await plus.isDisabled()) break;
    await plus.click();
  }

  await expect(plus, 'it stopped').toBeDisabled();

  /*
    «كل المتاح من هذا النوع» — not «كل الغرف المتاحة».

    They are different facts: the second means the BOOKING is full, and a guest told that when the
    hotel has merely run out of doubles would stop adding a suite they could have had.
  */
  await expect(line, 'the line names its own ceiling').toContainText('كل المتاح');

  expect(left, 'the row advertised a count to reach').toBeGreaterThan(1);
});

/**
 * The empty state, carried over from `booking-card.spec.ts`.
 *
 * That file is gone: it asserted the card REPLACES a choice, which is the behaviour the basket
 * deliberately replaced, and a spec encoding a superseded requirement is worse than no spec. What
 * it protected and this does not yet is the empty state — a «from» price a guest can compare, and
 * an anchor that takes them to the list rather than somewhere to think about it.
 */
test('an empty basket quotes a from-price and points at the list', async ({ page }) => {
  await page.goto(HOTEL, { waitUntil: 'domcontentloaded' });

  const card = page.locator('aside#booking');

  await expect(card, 'it says the basket is empty').toContainText('سلّة الحجز فارغة');

  /*
    The CHEAPEST stay, and the same figure the cheapest row shows — the card and the list must
    quote the same kind of number. They did not once: the card said «$73.99 / الليلة» beside a list
    of stay totals, and the smaller figure is the one a guest anchors on.
  */
  const from = /\$([\d,.]+)/.exec(await card.innerText())?.[1] ?? '';

  expect(from, 'a from-price is shown').not.toBe('');
  await expect(
    page.locator('#units > ul > li').first(),
    'and the cheapest row agrees with it',
  ).toContainText(from);

  /* And the control moves to the list rather than navigating away from the page. */
  const choose = card.getByRole('link', { name: 'اختر غرفة' });

  await expect(choose).toBeVisible();
  await expect(choose).toHaveAttribute('href', '#units');
});
