import { expect, test, type Page } from '@playwright/test';

import { stayFrom } from './free-nights.js';

/**
 * Every page title and every stay or trip name reads in bold (Bashar, 2026-10-02: «write every
 * hotel/property etc. name in bold also the group name … also every page title»).
 *
 * Read from the COMPUTED weight, not the class: a heading's weight can come from a utility, the
 * browser's default or a reset, and only what the reader sees counts. A sweep over the public pages
 * rather than one example each, because the titles that were not bold were scattered: «المدن»,
 * «اتصل بنا», the placeholder pages, the expired-link pages.
 */
const BASE = 'http://localhost:3000';
const { checkIn, checkOut } = stayFrom(14, 2);
const STAY = `checkIn=${checkIn}&checkOut=${checkOut}&adults=2`;

const weightsOf = (page: Page, selector: string): Promise<Array<[string, number]>> =>
  page
    .locator(selector)
    .evaluateAll((nodes) =>
      nodes.map((node): [string, number] => [
        (node.textContent ?? '').trim().slice(0, 40),
        Number(getComputedStyle(node).fontWeight),
      ]),
    );

const notBold = (weights: Array<[string, number]>) =>
  weights.filter(([, weight]) => weight < 700).map(([text]) => text);

test('every page title and section heading is bold', async ({ page }) => {
  const paths = [
    '/ar',
    '/ar/city',
    '/ar/city/damascus',
    '/ar/groups',
    '/ar/groups/coastal-syria-spring',
    '/ar/contact',
    '/ar/property/grand-umayyad-hotel',
    `/ar/search?${STAY}`,
    '/ar/find-booking',
    '/ar/login',
    '/ar/register',
    '/ar/forgot-password',
    '/ar/terms',
    '/ar/partners/join',
    '/ar/no-such-page',
  ];
  const failures: string[] = [];

  for (const path of paths) {
    await page.goto(`${BASE}${path}`);
    if ((await page.locator('h1').count()) === 0) failures.push(`${path}: no title`);
    /*
      Every heading, not only the title (Bashar, 2026-10-02, the second time): the first version
      checked `h1` alone, and fifteen section headings and room names stayed regular beside it.
    */
    const headings = await weightsOf(page, 'h1, main h2, main h3, main h4');
    failures.push(...notBold(headings).map((text) => `${path}: «${text}»`));
  }

  expect(failures).toEqual([]);
});

/*
  A name is set like the trip card's, which Bashar held up as the one to match: bold AND 18px. Bold
  at 16px is what the stay cards were, and they did not read like it.
*/
test('every stay, room and trip name is set like the trip card, wherever it is listed', async ({
  page,
}) => {
  const failures: string[] = [];
  const check = async (where: string, selector: string) => {
    const names = await page
      .locator(selector)
      .evaluateAll((nodes) =>
        nodes.map((node): [string, number, number] => [
          (node.textContent ?? '').trim().slice(0, 40),
          Number(getComputedStyle(node).fontWeight),
          parseFloat(getComputedStyle(node).fontSize),
        ]),
      );
    if (names.length === 0) failures.push(`${where}: nothing to check`);
    for (const [text, weight, size] of names) {
      if (weight < 700 || size < 18)
        failures.push(`${where}: «${text}» ${size}px/${weight}`);
    }
  };

  await page.goto(`${BASE}/ar`);
  await check('home, the picks', 'section[aria-label="مختارات"] li h3');
  await check('home, the trips', 'section[aria-label="جروبات"] li h3');

  await page.goto(`${BASE}/ar/groups`);
  await check('the trips list', 'main ul > li h3');

  await page.goto(`${BASE}/ar/city/damascus`);
  await check('a city page', 'main li h3 a');

  await page.goto(`${BASE}/ar/property/grand-umayyad-hotel`);
  await check('a property page, the rooms', '#units h3');

  await page.goto(`${BASE}/ar/search?${STAY}`);
  await check('the results', 'main article h3 a');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-map-thumbnail] button').click();
  await page.locator('[role="dialog"] section li').first().waitFor();
  await check('the map list', '[role="dialog"] section li h3 a');

  expect(failures).toEqual([]);
});
