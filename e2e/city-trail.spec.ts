import { expect, test, type Page } from '@playwright/test';

/**
 * A page inside a city says which city, straight under «الرئيسية» (Bashar, 2026-10-04).
 *
 * The trail read «الرئيسية › المدن › دمشق» from 2026-10-02 until the cities index was removed («I do
 * not need it anymore»); a step leading to a page that no longer exists would mislead, so it went
 * from every trail that carried it. Asked of the city itself, a stay in it and a landmark in it,
 * and of the `BreadcrumbList` a search engine reads as well as the visible trail, because the two
 * are written separately in each page and a fix to one leaves the other telling the old story.
 */
test.use({ baseURL: 'http://localhost:3000' });

async function trail(page: Page): Promise<string[]> {
  const nav = page.getByRole('navigation', { name: /مسار التنقل|Breadcrumb/ });
  return (await nav.locator('li').allInnerTexts())
    .map((text) => text.trim())
    .filter(Boolean);
}

async function structuredTrail(page: Page): Promise<string[]> {
  return page.locator('script[type="application/ld+json"]').evaluateAll((scripts) => {
    for (const script of scripts) {
      const graph = JSON.parse(script.textContent ?? '{}') as {
        '@type'?: string;
        itemListElement?: { name: string }[];
      };
      if (graph['@type'] === 'BreadcrumbList')
        return (graph.itemListElement ?? []).map((item) => item.name);
    }
    return [];
  });
}

/** A landmark in Damascus, read from the sitemap rather than written down. */
async function damascusLandmark(page: Page): Promise<string> {
  const sitemap = await (await page.request.get('/sitemap.xml')).text();
  const slug = /\/ar\/landmark\/(damascus-[^<]+)</.exec(sitemap)?.[1];
  expect(slug, 'the sitemap names a landmark in Damascus').toBeTruthy();
  return slug!;
}

const CASES = [
  {
    name: 'a city',
    path: () => '/ar/city/damascus',
    expected: ['الرئيسية', 'دمشق'],
  },
  {
    name: 'a city, in English',
    path: () => '/en/city/damascus',
    expected: ['Home', 'Damascus'],
  },
  {
    name: 'a stay in a city',
    path: () => '/ar/property/grand-umayyad-hotel',
    expected: ['الرئيسية', 'دمشق', 'فندق أمية الكبير'],
  },
];

for (const { name, path, expected } of CASES) {
  test(`${name} sits under its city in its trail and in its structured data`, async ({
    page,
  }) => {
    await page.goto(path());
    expect(await trail(page)).toEqual(expected);
    expect(await structuredTrail(page)).toEqual(expected);
  });
}

test('a landmark sits under its city', async ({ page }) => {
  await page.goto(`/ar/landmark/${await damascusLandmark(page)}`);
  const steps = await trail(page);
  expect(steps.slice(0, 2)).toEqual(['الرئيسية', 'دمشق']);
  expect(steps).toHaveLength(3);
  expect((await structuredTrail(page)).slice(0, 2)).toEqual(['الرئيسية', 'دمشق']);
});

test('no trail names the removed cities index', async ({ page }) => {
  await page.goto('/ar/city/damascus');
  await expect(
    page.getByRole('navigation', { name: 'مسار التنقل' }).locator('a[href$="/city"]'),
  ).toHaveCount(0);
});
