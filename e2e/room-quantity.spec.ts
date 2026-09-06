import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Taking more than one of the same room, from the page to the charge.
 *
 * ## What is being watched
 *
 * Not that a stepper increments — that a stepper the guest moved changes the TOTAL, and that the
 * total it changed to is the total checkout then quotes. A quantity control that adjusts a number
 * on the left while the right-hand side prices one room is the failure this whole card exists to
 * prevent, one field further in.
 */
const HOTEL = '/ar/property/grand-umayyad-hotel';

test.describe.configure({ mode: 'serial' });
/* The CUSTOMER app. The default project points at the console, which has no property pages. */
test.use({
  baseURL: 'http://localhost:3000',
  viewport: { width: 1440, height: 1100 },
});

/** The card, once a room is in it. */
async function chooseFirstMultiRoom(page: Page) {
  await page.goto(HOTEL, { waitUntil: 'domcontentloaded' });

  /*
    A type the hotel has SEVERAL of — found by the row that says so rather than named, because a
    row naming a specific suite would start passing for the wrong reason the day the fixture
    renames it.
  */
  const row = page.locator('#units > ul > li').filter({ hasText: 'متبقية' }).first();

  await expect(row, 'the hotel offers a room type with more than one free').toBeVisible();
  await row.getByRole('button', { name: 'احجز هذه الوحدة' }).click();

  return page.locator('aside#booking');
}

/** The card's total, as a number. */
async function total(card: Locator): Promise<number> {
  return Number(
    await card.locator('[data-summary-total]').getAttribute('data-summary-total'),
  );
}

test('the stepper appears only where there is a quantity to choose', async ({ page }) => {
  const card = await chooseFirstMultiRoom(page);

  await expect(card.getByText('عدد الغرف')).toBeVisible();

  /*
    The opposite control. A one-of-a-kind room must NOT offer a stepper — a control that cannot
    move is the defect this review keeps finding, and without this assertion "show a stepper" and
    "show a stepper everywhere" pass identically.
  */
  const lonely = page
    .locator('#units > ul > li')
    .filter({ hasNotText: 'متبقية' })
    .first();

  if ((await lonely.count()) > 0) {
    await lonely.getByRole('button', { name: 'احجز هذه الوحدة' }).click();
    await expect(card.getByText('عدد الغرف')).toBeHidden();
  }
});

test('two rooms cost twice one, on the card and then at checkout', async ({ page }) => {
  const card = await chooseFirstMultiRoom(page);

  const one = await total(card);

  expect(one, 'the card priced one room').toBeGreaterThan(0);

  await card.getByRole('button', { name: /زيادة/ }).click();

  await expect(card.locator('[data-summary-rooms]')).toHaveAttribute(
    'data-summary-rooms',
    '2',
  );

  const two = await total(card);

  /*
    Not exactly double: the SAFRA fee is charged once per booking when it is flat, so the room
    doubles and the fee does not. What must hold is that the total MOVED and moved upward by
    roughly a room — a card that showed the same figure for one room and two would pass a test
    asserting only that the number is positive.
  */
  expect(two, 'the total followed the stepper').toBeGreaterThan(one);
  expect(two).toBeLessThanOrEqual(one * 2);
  expect(two).toBeGreaterThan(one * 1.8);

  /* And the button carries the quantity, so checkout cannot quote a different stay. */
  const href =
    (await card.getByRole('link', { name: 'احجز الآن' }).getAttribute('href')) ?? '';

  expect(href).toContain('rooms=2');

  await card.getByRole('link', { name: 'احجز الآن' }).click();
  await page.waitForURL(/\/checkout\?/);

  await expect(page.locator('main'), 'checkout says how many rooms').toContainText(
    'غرفتان',
  );

  /*
    The figure the guest agreed to is the figure they are asked to pay. Compared as NUMBERS
    because the two screens format in the same currency but the assertion is about money, not
    about a string.
  */
  const charged = Number(
    await page.locator('[data-checkout-total]').getAttribute('data-checkout-total'),
  );

  expect(charged, 'checkout quoted the card’s total').toBeCloseTo(two, 2);
});

test('the stepper stops at what the hotel actually has', async ({ page }) => {
  const card = await chooseFirstMultiRoom(page);

  const plus = card.getByRole('button', { name: /زيادة/ });

  /* Walk it to the ceiling. Ten presses is above the contract's own cap, so this always arrives. */
  for (let i = 0; i < 10; i += 1) {
    if (await plus.isDisabled()) break;
    await plus.click();
  }

  await expect(plus, 'it stopped').toBeDisabled();

  /*
    And it SAYS why. A «+» that silently stops responding tells a guest nothing; the sentence is
    what lets them book what is left here and the rest elsewhere.
  */
  await expect(card).toContainText('كل الغرف المتاحة');

  const reached = Number(
    await card.locator('[data-summary-rooms]').getAttribute('data-summary-rooms'),
  );
  const left = await page
    .locator('#units > ul > li')
    .filter({ hasText: 'متبقية' })
    .first()
    .innerText();

  /* The ceiling is the number the row advertises — the two must not disagree. */
  expect(left).toContain(String(reached));
});

test('choosing a different room resets the quantity', async ({ page }) => {
  const card = await chooseFirstMultiRoom(page);

  await card.getByRole('button', { name: /زيادة/ }).click();
  await expect(card.locator('[data-summary-rooms]')).toHaveAttribute(
    'data-summary-rooms',
    '2',
  );

  /*
    Three of a standard room is not three of a suite, and the suite may not have three. Carrying
    the number across would quote a stay nobody asked for.
  */
  const other = page.locator('#units > ul > li').filter({ hasText: 'متبقية' }).nth(1);

  if ((await other.count()) === 0) test.skip();

  await other.getByRole('button', { name: 'احجز هذه الوحدة' }).click();
  await expect(card.locator('[data-summary-rooms]')).toHaveAttribute(
    'data-summary-rooms',
    '1',
  );
});
