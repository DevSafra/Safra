import { expect, test } from '@playwright/test';

/**
 * Every public page runs its scripts (2026-10-02).
 *
 * `/ar/city`, `/ar/contact` and `/ar/medical-tourism` were `force-static`, so each served the nonce
 * of its build against a header carrying a fresh one, and the browser refused all forty scripts.
 * The pages rendered, answered 200 and read correctly, and nothing a reader could press worked: the
 * menu, the theme, the language switch. Two questions per page, because either alone can pass:
 *
 * - **No script is refused** by the policy. Counted from the console, and only `script-src`
 *   refusals: the policy is the thing being tested, not the dev host's prefetches.
 * - **A chosen night theme is applied.** The pre-paint script is the first script on the page; if
 *   it runs, `data-theme` is `dark`. A page whose scripts are blocked stays white.
 */
const BASE = 'http://localhost:3000';
const PAGES = [
  '/ar',
  '/ar/city/damascus',
  '/ar/contact',
  '/ar/medical-tourism',
  '/ar/groups',
  '/ar/groups/coastal-syria-spring',
  '/ar/terms',
  '/ar/privacy',
  '/ar/find-booking',
  '/ar/partners/join',
  '/en/city/damascus',
  '/en/contact',
];

test('every public page runs its scripts and applies the chosen theme', async ({
  browser,
}) => {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('safra-theme-web', 'dark'));
  const page = await context.newPage();

  const failures: string[] = [];
  let refused = 0;
  page.on('console', (message) => {
    if (
      message.text().includes('Content Security Policy') &&
      message.text().includes('script-src')
    ) {
      refused += 1;
    }
  });

  for (const path of PAGES) {
    refused = 0;
    await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
    await page.waitForTimeout(200);
    const theme = await page.evaluate(
      () => document.documentElement.dataset['theme'] ?? null,
    );
    if (refused > 0) failures.push(`${path}: ${refused} scripts refused`);
    if (theme !== 'dark') failures.push(`${path}: the night theme did not apply`);
  }

  await context.close();
  expect(failures).toEqual([]);
});
