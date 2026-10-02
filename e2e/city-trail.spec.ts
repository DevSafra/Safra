import { expect, test, type Page } from '@playwright/test';

/**
 * A page inside a city says it is inside «المدن» (Bashar, 2026-10-02, screenshot «15.21.28»: the
 * city page read «الرئيسية › دمشق», and «the correct path would be الرئيسية - المدن - دمشق»).
 *
 * Every page whose trail passes through a city, not only the one reported: the city itself, a stay
 * in it and a landmark in it all skipped the index. Asked of the visible trail AND of the
 * `BreadcrumbList` a search engine reads, because the two are written separately in each page and
 * a fix to one leaves the other telling the old story.
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
    expected: ['الرئيسية', 'المدن', 'دمشق'],
  },
  {
    name: 'a city, in English',
    path: () => '/en/city/damascus',
    expected: ['Home', 'Cities', 'Damascus'],
  },
  {
    name: 'a stay in a city',
    path: () => '/ar/property/grand-umayyad-hotel',
    expected: ['الرئيسية', 'المدن', 'دمشق', 'فندق أمية الكبير'],
  },
];

for (const { name, path, expected } of CASES) {
  test(`${name} sits under «المدن» in its trail and in its structured data`, async ({
    page,
  }) => {
    await page.goto(path());
    expect(await trail(page)).toEqual(expected);
    expect(await structuredTrail(page)).toEqual(expected);
  });
}

test('a landmark sits under «المدن», then its city', async ({ page }) => {
  await page.goto(`/ar/landmark/${await damascusLandmark(page)}`);
  const steps = await trail(page);
  expect(steps.slice(0, 3)).toEqual(['الرئيسية', 'المدن', 'دمشق']);
  expect(steps).toHaveLength(4);
  expect((await structuredTrail(page)).slice(0, 3)).toEqual([
    'الرئيسية',
    'المدن',
    'دمشق',
  ]);
});

test('«المدن» in the trail opens the cities index', async ({ page }) => {
  await page.goto('/ar/city/damascus');
  await page
    .getByRole('navigation', { name: 'مسار التنقل' })
    .getByRole('link', { name: 'المدن' })
    .click();
  await expect(page).toHaveURL(/\/ar\/city$/);
});
