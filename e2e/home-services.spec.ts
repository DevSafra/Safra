import { expect, test } from '@playwright/test';

/**
 * SAFRA's six services, where the home page's cities row was (Bashar, 2026-10-04: remove «المدن»
 * «completely … I do not need it anymore», and screenshot «14.59.04» in place of «مدن تسهر معك»).
 *
 * Three services have a page and are links; three do not yet and say «قريباً» instead of leading
 * anywhere (his choice). A card that looks pressable and goes nowhere is the state this asserts
 * cannot ship, so the three are checked to contain no link at all, not merely to look different.
 */
test.use({ baseURL: 'http://localhost:3000' });

const ORDER = ['realEstate', 'umrah', 'trips', 'medical', 'stay', 'rides'];

test('the home page shows the six services in the reference order', async ({ page }) => {
  await page.goto('/ar');
  const row = page.getByRole('region', { name: 'خدمات سفرة' });

  await expect(row.locator('[data-service]')).toHaveCount(6);
  expect(
    await row
      .locator('[data-service]')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-service'))),
  ).toEqual(ORDER);

  await expect(row.locator('[data-service="stay"] a')).toHaveAttribute(
    'href',
    '/ar/search',
  );
  await expect(row.locator('[data-service="medical"] a')).toHaveAttribute(
    'href',
    '/ar/medical-tourism',
  );
  await expect(row.locator('[data-service="trips"] a')).toHaveAttribute(
    'href',
    '/ar/groups',
  );

  for (const code of ['rides', 'umrah', 'realEstate']) {
    const card = row.locator(`[data-service="${code}"]`);
    await expect(card, `${code} says it is coming`).toContainText('قريباً');
    await expect(
      card.locator('a'),
      `${code} leads nowhere, so it is not a link`,
    ).toHaveCount(0);
  }

  /* The row it replaced is gone, with its way to the removed page. */
  await expect(page.locator('main a[href$="/city"]')).toHaveCount(0);
});

test('the English home page names each service in English beneath its brand', async ({
  page,
}) => {
  await page.goto('/en');
  const row = page.getByRole('region', { name: 'SAFRA services' });
  await expect(row.locator('[data-service="stay"]')).toContainText('Safra Stay');
  await expect(row.locator('[data-service="stay"]')).toContainText('Hotels and stays');
  await expect(row.locator('[data-service="rides"]')).toContainText('Coming soon');
});

test('the cities page is gone, in every language', async ({ request }) => {
  for (const path of ['/ar/city', '/en/city', '/de/city']) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
  /* A city's own page stays: it is what the stays are listed on. */
  expect((await request.get('/ar/city/damascus')).status()).toBe(200);
});
