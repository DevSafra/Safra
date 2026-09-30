import { expect, test } from '@playwright/test';

/**
 * A group trip's dates read as two whole dates, never as one sentence broken mid-date.
 *
 * The range used to be «{from} ← {to}» in a quarter-width column, and two Levantine dates do not
 * fit a quarter of the page: the line broke wherever it ran out, leaving «الأربعاء،» at the end of
 * one line and «3 شباط» alone on the next (Bashar, 2026-09-30). Every width is checked because the
 * column is a quarter of the page from `sm` up and the whole card below it, so the break moved
 * with the viewport rather than happening at one.
 *
 * `coastal-syria-spring` is the testbed's trip, seeded by `seed-testbed.ts`.
 */
const BASE = 'http://localhost:3000';
const WIDTHS = [390, 768, 1024, 1440];

for (const locale of ['ar', 'en']) {
  for (const width of WIDTHS) {
    test(`${locale} at ${width}px: each date is one whole line inside its column`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE}/${locale}/groups/coastal-syria-spring`);

      const dates = page.locator('[data-trip-date]');
      await expect(dates).toHaveCount(2);

      const lines = await dates.evaluateAll((nodes) =>
        nodes.map((node) => {
          const lineHeight = parseFloat(getComputedStyle(node).lineHeight);
          const box = node.getBoundingClientRect();
          const cell = node.closest('dd')!.parentElement!.getBoundingClientRect();
          return {
            text: node.textContent ?? '',
            lines: Math.round(box.height / lineHeight),
            outside: Math.max(cell.left - box.left, box.right - cell.right),
          };
        }),
      );

      for (const line of lines) {
        expect(line.text, 'a date line carries a day number').toMatch(/\d/);
        expect(line.lines, `«${line.text}» broke across lines`).toBe(1);
        expect(
          line.outside,
          `«${line.text}» spills out of its column`,
        ).toBeLessThanOrEqual(0);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        'the page scrolls sideways',
      ).toBeLessThanOrEqual(0);
    });
  }
}

test('a screen reader hears the range as one sentence, departure first', async ({
  page,
}) => {
  await page.goto(`${BASE}/ar/groups/coastal-syria-spring`);
  const [from, to] = await page.locator('[data-trip-date]').allTextContents();
  const sentence = await page.locator('dl dd .sr-only').first().textContent();

  expect(sentence).toContain(from);
  expect(sentence).toContain(to);
  expect(sentence!.indexOf(from!)).toBeLessThan(sentence!.indexOf(to!));
});
