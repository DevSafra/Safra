import { expect, test, type Page } from '@playwright/test';

import { PARTNER_BASE, PARTNER_STATE } from './partner-session.js';
import { MISSING_CREDENTIALS, SKIP_REASON } from './staff.js';

/**
 * لوحة الشريك at every device width — the half of «every UI must work on every device» that was
 * never swept.
 *
 * ## What was and was not covered
 *
 * `responsive.spec.ts` walks every console section at six widths and the customer pages beside
 * them. Of the partner portal it checked exactly one thing: that a control on the LOGIN page meets
 * the height floor. Every authenticated screen a partner actually works in — العقارات، الحجوزات،
 * التقويمات، الموظفون، الدفعات، المخالفات، الدعم — was outside the sweep entirely, which is how the
 * rule «no page ever scrolls sideways» came to be enforced on two applications out of three.
 *
 * Found on 2026-09-04 while auditing for the controlled-launch review, in the same pass that found
 * a partner could not submit a listing at all. Both are the same shape: nothing failing, because
 * nothing was looking.
 *
 * ## Why these widths
 *
 * The four the standing rule names. 1024 is the one that regresses silently — wide enough to look
 * right in a screenshot and narrow enough for a two-column layout to run out of room — and it is
 * the width at which a partner most often opens this portal, on a tablet at a reception desk.
 */
const WIDTHS = [390, 768, 1024, 1440];

/**
 * Every authenticated screen, explicit rather than crawled.
 *
 * A list is a thing somebody maintains, and that is the point here: adding a screen to the portal
 * should be a visible addition to this file. A crawl would silently cover whatever the navigation
 * happened to link to on the day it ran, which is how a screen reachable only by a deep link — the
 * property sub-pages below — escapes a sweep that looks like it covers everything.
 */
const SCREENS = [
  '/',
  '/properties',
  '/calendars',
  '/arrivals',
  '/contracts',
  '/coupons',
  '/employees',
  '/employee-roles',
  '/payouts',
  '/payouts/accounts',
  '/reviews',
  '/support',
  '/violations',
];

test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.use({ baseURL: PARTNER_BASE, storageState: PARTNER_STATE });

/** The same measurement the console sweep makes, including the RTL direction. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const by = doc.scrollWidth - doc.clientWidth;

    if (by <= 1) return null;

    let worst = '';
    let worstBy = 0;

    for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const box = element.getBoundingClientRect();
      /* RTL overflows to the LEFT, so a negative `left` counts as much as an excessive `right`. */
      const amount = Math.max(-box.left, box.right - doc.clientWidth);

      if (amount > worstBy) {
        worstBy = amount;
        worst = `${element.tagName.toLowerCase()}[${(element.className || '').toString().slice(0, 40)}]`;
      }
    }

    return `+${by}px, widest offender ${worst}`;
  });
}

for (const width of WIDTHS) {
  test(`no partner screen scrolls sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });

    const broken: string[] = [];

    for (const path of SCREENS) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      const result = await overflow(page);

      if (result) broken.push(`${path} ${result}`);
    }

    expect(broken, `screens scrolling sideways at ${width}px`).toEqual([]);
  });
}

/**
 * The property sub-screens, which no navigation links to and a crawl would therefore miss.
 *
 * تعديل carries the widest content in the portal: the editor, the unit rows, the «إضافة وحدة» form
 * and — since 2026-09-04 — the «إرسال للمراجعة» card. Four fields across a 390px column is exactly
 * where a `grid-cols-3` without a wrap breaks, so this is the screen most worth measuring rather
 * than assuming.
 */
test('the property sub-screens fit every width', async ({ page }) => {
  const reference = await firstPropertyReference(page);

  test.skip(reference === null, 'This partner has no listing to open.');

  const broken: string[] = [];

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });

    for (const suffix of ['edit', 'images', 'calendar']) {
      await page.goto(`/properties/${reference!}/${suffix}`, {
        waitUntil: 'domcontentloaded',
      });

      const result = await overflow(page);

      if (result) broken.push(`${width}px ${suffix} ${result}`);
    }
  }

  expect(broken).toEqual([]);
});

/**
 * Every control a partner can press is at least 40px high below `lg`, where the input is a finger.
 *
 * Measured on تعديل because that is where the portal's newest controls are, and because a control
 * that is present but too small to press is not a control — it is the same defect as one that is
 * missing, arriving through a different door.
 */
test('every control on تعديل meets the touch floor at 390px', async ({ page }) => {
  const reference = await firstPropertyReference(page);

  test.skip(reference === null, 'This partner has no listing to open.');

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/properties/${reference!}/edit`, { waitUntil: 'domcontentloaded' });

  const short = await page.evaluate(() => {
    const out: string[] = [];

    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>(
        'main button, main a, main input, main select',
      ),
    )) {
      const box = element.getBoundingClientRect();

      /* Hidden, or a link inside a sentence — WCAG 2.5.8 exempts the inline case. */
      if (box.height === 0 || box.width === 0) continue;
      if (element.tagName === 'A' && element.closest('p')) continue;

      /*
        A checkbox or radio is 15-16px whatever it is styled as, and the thing a finger presses is
        the LABEL that wraps it. So the target measured is the label's box, not the tick's — the
        floor is carried there by one rule in `globals.css` rather than by thirteen class strings.
      */
      const input = element as HTMLInputElement;
      const wrapping =
        element.tagName === 'INPUT' &&
        (input.type === 'checkbox' || input.type === 'radio')
          ? element.closest('label')
          : null;

      if (wrapping) {
        if (wrapping.getBoundingClientRect().height >= 40) continue;

        out.push(
          `label around ${input.type} "${(wrapping.textContent ?? '').trim().slice(0, 24)}" ${wrapping.getBoundingClientRect().height.toFixed(0)}px`,
        );
        continue;
      }

      if (box.height < 40) {
        out.push(
          `${element.tagName.toLowerCase()} "${(element.textContent ?? '').trim().slice(0, 24)}" ${box.height.toFixed(0)}px`,
        );
      }
    }

    return out;
  });

  expect(short, 'controls below the 40px touch floor').toEqual([]);
});

/** The first listing this partner owns, or null. */
async function firstPropertyReference(page: Page): Promise<string | null> {
  await page.goto('/properties', { waitUntil: 'domcontentloaded' });

  const href = await page
    .locator('a[href*="/properties/"][href$="/edit"]')
    .first()
    .getAttribute('href')
    .catch(() => null);

  return href?.split('/')[2] ?? null;
}
