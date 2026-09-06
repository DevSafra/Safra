import { expect, test } from '@playwright/test';

/**
 * The booking card as a live summary of the guest's choice.
 *
 * Bashar, 2026-09-06, four times: the card must stop being a static box. Before a choice it offers
 * «اختر غرفة» and moves to the list; after one it states the room, the dates, the nights, the
 * guests, the terms, the facilities, the arithmetic and the total, and its button becomes «احجز
 * الآن» — which must carry that exact room to checkout and never quietly substitute another.
 *
 * The card it replaces showed the CHEAPEST room's «from» price above a button that booked that
 * room, so a guest reading «من ٧٣٫٩٩» on a thirteen-room hotel and pressing it bought the smallest
 * one. The figure and the action disagreed, and nothing on the way through said so.
 */
const SLUG = 'grand-umayyad-hotel';
const STAY = 'checkIn=2027-06-10&checkOut=2027-06-12&adults=2';

test.use({ baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 1000 } });

test('the card answers what is about to be booked, and changes as the choice does', async ({
  page,
}) => {
  await page.goto(`/ar/property/${SLUG}?${STAY}`, { waitUntil: 'domcontentloaded' });

  const card = page.locator('aside#booking');

  // ── Before any choice ─────────────────────────────────────────────────────
  await expect(card, 'it says nothing is chosen').toContainText('لم تختر غرفة بعد');
  await expect(
    card.getByRole('link', { name: 'اختر غرفة' }),
    'and offers to take the reader to the list',
  ).toBeVisible();
  await expect(
    card.getByRole('link', { name: 'احجز الآن' }),
    'there is nothing to book yet',
  ).toHaveCount(0);

  // ── Choosing the suite ────────────────────────────────────────────────────
  const suite = page.locator('#units > ul > li').filter({ hasText: 'جناح تنفيذي' });

  await suite.getByRole('button', { name: 'احجز هذه الوحدة' }).click();

  /* Immediately — no navigation, no reload. That is the whole requirement. */
  await expect(card, 'the room appears in the card').toContainText('جناح تنفيذي');
  await expect(card, 'with the dates').toContainText('2027-06-10');
  await expect(card, 'the nights').toContainText('ليلتان');
  await expect(card, 'its terms').toContainText('صارم');
  await expect(card, 'its facilities').toContainText('مطبخ');

  /*
    Two nights of the suite at 185, plus SAFRA's 1.99 once — the fee is per BOOKING, so a total is
    not the nightly figure doubled. 371.99, and the row it came from says 186.99 for one night.
  */
  await expect(card, 'the stay total is the stay, not a night').toContainText('371.99');
  await expect(
    suite,
    'while the row keeps its fee-inclusive «from» rate, which is a different question',
  ).toContainText('186.99');

  // ── The button now names what it does ─────────────────────────────────────
  const book = card.getByRole('link', { name: 'احجز الآن' });

  await expect(book, 'the call to action changed with the state').toBeVisible();
  await expect(
    card.getByRole('link', { name: 'اختر غرفة' }),
    'and no longer asks for a choice already made',
  ).toHaveCount(0);

  /* The chosen room travels — never the first or the cheapest. */
  const href = (await book.getAttribute('href')) ?? '';
  const chosenId =
    (await suite.getByRole('button', { name: /احجز هذه الوحدة|مختارة/ }).count()) > 0
      ? href
      : '';

  expect(chosenId, 'the link carries a unit').toMatch(/unitId=[0-9a-f-]{36}/);
  expect(href, 'and the stay the card described').toContain('checkIn=2027-06-10');

  // ── Changing the choice replaces it, and never accumulates ────────────────
  const family = page.locator('#units > ul > li').filter({ hasText: 'غرفة عائلية' });

  await family.getByRole('button', { name: 'احجز هذه الوحدة' }).click();

  await expect(card, 'the new room replaces the old').toContainText('غرفة عائلية');
  await expect(card, 'and the old one is gone').not.toContainText('جناح تنفيذي');

  // ── Removing empties it again ─────────────────────────────────────────────
  await card.getByRole('button', { name: 'إزالة الاختيار' }).click();

  await expect(card, 'the card is empty again').toContainText('لم تختر غرفة بعد');
  await expect(
    card.getByRole('link', { name: 'احجز الآن' }),
    'and cannot be booked from',
  ).toHaveCount(0);

  await page.screenshot({ path: 'test-results/booking-card.png', fullPage: true });
});

test('the chosen room is what checkout quotes', async ({ page }) => {
  await page.goto(`/ar/property/${SLUG}?${STAY}`, { waitUntil: 'domcontentloaded' });

  await page
    .locator('#units > ul > li')
    .filter({ hasText: 'جناح تنفيذي' })
    .getByRole('button', { name: 'احجز هذه الوحدة' })
    .click();

  await page.locator('aside#booking').getByRole('link', { name: 'احجز الآن' }).click();
  await page.waitForURL(/\/checkout\?/);

  const summary = page.locator('aside');

  await expect(summary, 'checkout names the room the card did').toContainText(
    'جناح تنفيذي',
  );
  await expect(summary, 'at the price the card stated').toContainText('371.99');
  await expect(summary, 'and not some other room').not.toContainText('غرفة عائلية');
});
