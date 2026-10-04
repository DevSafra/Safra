import { expect, test } from '@playwright/test';

/**
 * The home page's «جروبات» row, in the place «كيف يعمل الحجز» held (Bashar, 2026-10-02).
 *
 * It shows the trips still to come and nothing else, because a finished trip on the front page is an
 * advertisement for something nobody can join. The groups page is the reference: every card there
 * that is not labelled «انتهت» must be in the row, and none that is.
 */
const BASE = 'http://localhost:3000';

test('the home page offers every upcoming group trip in a slider, and no finished one', async ({
  page,
}) => {
  await page.goto(`${BASE}/ar/groups`);
  const cards = page.locator('main ul > li');
  const upcoming = (
    await cards.evaluateAll((items) =>
      items
        .filter((item) => !item.textContent?.includes('انتهت'))
        .map((item) => item.querySelector('a')?.getAttribute('href') ?? ''),
    )
  ).sort();

  expect(
    upcoming.length,
    'the testbed announces at least one upcoming trip',
  ).toBeGreaterThan(0);

  await page.goto(`${BASE}/ar`);
  const row = page.getByRole('region', { name: 'جروبات' });

  await expect(row).toBeVisible();
  await expect(page.getByRole('region', { name: 'كيف يعمل الحجز' })).toHaveCount(0);

  const shown = (
    await row
      .locator('li > a')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''))
  ).sort();

  expect(shown).toEqual(upcoming);
  await expect(row.getByRole('link', { name: 'كل الرحلات الجماعية' })).toHaveAttribute(
    'href',
    '/ar/groups',
  );
});

/*
  The gold face also paints decorations, like the review score on a property page. Only what can be
  pressed lifts under the pointer: a badge that rose on hover would claim to be a button. The
  opposite control is a real gold button, which must still lift.
*/
test('a gold decoration stays still on hover, and a gold button still lifts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const shadowOn = async (selector: string) => {
    const element = page.locator(selector).first();
    await element.scrollIntoViewIfNeeded();
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
    const before = await element.evaluate((node) => getComputedStyle(node).boxShadow);
    await element.hover();
    await page.waitForTimeout(400);
    const after = await element.evaluate((node) => getComputedStyle(node).boxShadow);
    return { before, after };
  };

  await page.goto(`${BASE}/ar/property/grand-umayyad-hotel`);
  const badge = await shadowOn('span.btn-gold');
  expect(badge.after, 'the badge does not lift').toBe(badge.before);

  await page.goto(`${BASE}/ar`);
  const button = await shadowOn('form button.btn-gold');
  expect(button.after, 'the button lifts').not.toBe(button.before);
});
