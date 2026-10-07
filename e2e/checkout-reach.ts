import { expect, type Page } from '@playwright/test';

/*
  The way a guest reaches checkout, shared by the specs that need one (2026-10-07): search, open a
  property, add a room, follow the basket. Moved out of `customer-coupon.spec.ts` when the
  oversized-party spec needed the same walk; two copies would drift the way the coupon one already
  had once.
*/
/** The first bookable unit the search offers, with dates far enough out to be free. */
export async function reachCheckout(page: Page): Promise<boolean> {
  await page.goto('/ar/search');

  const property = page.locator('a[href*="/property/"]').first();

  if ((await property.count()) === 0) return false;

  await property.click();
  await page.waitForURL(/\/property\//);

  /*
    A unit has to be CHOSEN before a checkout link exists.

    This looked for `a[href*="/checkout?"]` on the property page and gave up when it found none —
    which is always, because «احجز الآن» lives in the basket and the basket is empty until a room
    is added. So both coupon tests skipped themselves on every run with «No bookable unit to reach
    checkout with», on a platform where the search page lists two dozen bookable properties. A
    skip is not a pass, and this one hid the discount code end to end.

    The three steps are the ones a guest takes and the ones `multi-room-downstream` already walks:
    pick a room, then follow the basket.
  */
  const unit = page.locator('#units > ul > li').first();

  if ((await unit.count()) === 0) return false;

  const add = unit.getByRole('button', { name: /أضف إلى الحجز|في الحجز/ });

  if ((await add.count()) === 0) return false;

  await add.click();

  const book = page.locator('aside#booking').getByRole('link', { name: 'احجز الآن' });

  await expect(book, 'the basket offers a way to check out').toBeVisible({
    timeout: 10_000,
  });
  await book.click();
  await page.waitForURL(/\/checkout\?/);

  return true;
}
