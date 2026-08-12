import { expect, test, type Page } from '@playwright/test';

import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * Every screen must work on every device — the project rule, asserted.
 *
 * ## What "responsive" is checked as here
 *
 * **No horizontal page scroll.** It is the one property that is objective, that a person notices
 * immediately, and that no other test in the suite can see. A page that scrolls sideways on a
 * phone hides content off the edge and, in this console, took the sidebar with it.
 *
 * Layout QUALITY — whether a table would be better as cards on a phone — is a design judgement
 * and is not something a test should pretend to measure. This is the floor.
 *
 * ## The class of bug it catches
 *
 * A grid or flex item defaults to `min-width: auto` and refuses to shrink below its content, so
 * one wide table made its panel 898px inside a 342px column. Measured before the fix: 7 of the 19
 * console sections overflowed at 390px and 3 still did at 1024px. The fix is a single
 * zero-specificity rule in each app's `globals.css`; this is what keeps it fixed.
 *
 * ## Widths
 *
 * The five device classes the requirement names: phone, tablet, laptop, desktop, large screen.
 * 1024 is the one that regresses silently, because it is wide enough to look fine in a
 * screenshot; 2560 is where a "plenty of room" assumption hides a control.
 */
const WIDTHS = [390, 768, 1024, 1440, 1920, 2560];

/** Every console section. Kept explicit so a new route is a visible addition here. */
const CONSOLE = [
  '/',
  '/bookings',
  '/partners',
  '/properties',
  '/customers',
  '/staff',
  '/payments',
  '/wallet',
  '/giftcards',
  '/coupons',
  '/ads',
  '/disputes',
  '/messages',
  '/comms',
  '/geo',
  '/reports',
  '/settings',
  '/audit',
  '/emergency',
];

const CUSTOMER = [
  '/ar',
  '/ar/search',
  '/ar/city/petra',
  /*
    A property page, added 2026-08-12. Its breadcrumb carried two 36x17 links and no responsive test had
    ever requested the route — the same blind spot that hid the city page's, which only surfaced when
    that route stopped answering 500.
  */
  '/ar/property/coastal-resort',
  '/ar/login',
  '/ar/register',
  '/ar/forgot-password',
  '/ar/account',
  '/ar/checkout',
  '/en',
  '/en/search',
  '/de',
];

/**
 * The smallest a control may be where the input is a finger.
 *
 * 40px, applied below `lg` — the same boundary at which the console's sidebar becomes a drawer,
 * because that is the width at which the input stops being a pointer. WCAG 2.5.8 asks for 24×24;
 * this is the comfort target, and the audit found controls at 17px.
 *
 * Exempt, deliberately: `sr-only` links (1×1 until focused, which is correct) and links INSIDE a
 * sentence, which WCAG exempts as "inline" — growing one changes the line height of the paragraph
 * around it.
 */
const TOUCH_FLOOR = 40;

async function smallTargets(page: Page) {
  return page.evaluate((floor) => {
    const found: string[] = [];

    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, a[href], select, summary, [role="button"]',
      ),
    )) {
      const box = element.getBoundingClientRect();

      if (box.width === 0 || box.height === 0) continue;
      if (element.className.toString().includes('sr-only')) continue;
      if (box.height >= floor) continue;

      if (element.tagName === 'A') {
        const parent = element.parentElement;
        const siblingText = parent
          ? Array.from(parent.childNodes)
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => (node.textContent ?? '').trim())
              .join('')
          : '';

        // A link with prose beside it is inline in a sentence — exempt.
        if (siblingText.length > 2) continue;
      }

      found.push(
        `${element.tagName.toLowerCase()} ${Math.round(box.width)}x${Math.round(box.height)} "${(element.textContent ?? '').trim().slice(0, 18)}"`,
      );
    }

    return found;
  }, TOUCH_FLOOR);
}

/**
 * Reports the widest offender rather than just a boolean.
 *
 * A failure that says "the page is 138px too wide" sends you looking; one that names
 * `section[rounded-[15px]…]` sends you to the element. The difference decides whether the next
 * person fixes it or suppresses it.
 */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const by = doc.scrollWidth - doc.clientWidth;

    if (by <= 1) return null;

    let worst = '';
    let worstBy = 0;

    for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const box = element.getBoundingClientRect();
      // RTL overflows to the LEFT, so a negative `left` counts as much as an excessive `right`.
      const amount = Math.max(-box.left, box.right - doc.clientWidth);

      if (amount > worstBy) {
        worstBy = amount;
        worst = `${element.tagName.toLowerCase()}[${(element.className || '').toString().slice(0, 40)}]`;
      }
    }

    return `+${by}px, widest offender ${worst}`;
  });
}

test.describe('the staff console', () => {
  test.skip(MISSING_CREDENTIALS, SKIP_REASON);
  test.use({ storageState: STAFF_STATE });

  for (const width of WIDTHS) {
    test(`no section scrolls sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });

      const broken: string[] = [];

      for (const path of CONSOLE) {
        await page.goto(path);
        const result = await overflow(page);

        if (result) broken.push(`${path} ${result}`);
      }

      expect(broken).toStrictEqual([]);
    });
  }

  /** Controls are thumb-sized where the input is a thumb. */
  for (const width of [390, 768]) {
    test(`controls meet the ${TOUCH_FLOOR}px floor at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });

      const broken: string[] = [];

      for (const path of CONSOLE) {
        await page.goto(path);
        const small = await smallTargets(page);

        if (small.length > 0) broken.push(`${path}: ${small.join(', ')}`);
      }

      expect(broken).toStrictEqual([]);
    });
  }

  /**
   * A wide table SCROLLS; it is not crushed.
   *
   * The other half of the fix. Letting the panel shrink would be worthless if the table shrank
   * with it — eight columns of Arabic in 304px is unreadable. The table keeps its width and the
   * box scrolls, which is what `overflow-x-auto` was there for all along.
   */
  test('a wide table scrolls inside its own box on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 850 });
    await page.goto('/partners');

    const box = page.locator('div.overflow-x-auto').first();
    const measured = await box.evaluate((element) => ({
      visible: element.clientWidth,
      content: element.scrollWidth,
    }));

    expect(measured.content).toBeGreaterThan(measured.visible);
    expect(measured.content).toBeGreaterThan(700);
  });

  /**
   * A phone opens on the CONTENT, with the navigation collapsed.
   *
   * This assertion has been strengthened twice. First the sidebar rendered above the content, so
   * nineteen nav links pushed every section below the fold. Then it moved below the content in the
   * DOM. Now it is collapsed by default and reached through the hamburger, which is better than
   * either — so what is asserted is that the content starts near the top and the nav is not
   * occupying the screen.
   */
  test('a phone opens on the content, with the navigation collapsed', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 850 });
    await page.goto('/bookings');

    const main = await page.locator('main').boundingBox();

    expect(main?.y ?? 999).toBeLessThan(60);
    await expect(page.locator('#console-nav')).toBeHidden();
    // And it is one press away — the toggle is the subject of `sidebar.spec.ts`.
    await expect(page.locator('#sidebar-toggle')).toBeVisible();
  });
});

test.describe('the customer site', () => {
  test.use({ baseURL: 'http://localhost:3000' });

  for (const width of WIDTHS) {
    test(`no page scrolls sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });

      const broken: string[] = [];

      for (const path of CUSTOMER) {
        await page.goto(path);
        const result = await overflow(page);

        if (result) broken.push(`${path} ${result}`);
      }

      expect(broken).toStrictEqual([]);
    });
  }

  for (const width of [390, 768]) {
    test(`controls meet the ${TOUCH_FLOOR}px floor at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });

      const broken: string[] = [];

      for (const path of CUSTOMER) {
        await page.goto(path);
        const small = await smallTargets(page);

        if (small.length > 0) broken.push(`${path}: ${small.join(', ')}`);
      }

      expect(broken).toStrictEqual([]);
    });
  }

  /**
   * The primary navigation is reachable on a phone.
   *
   * It was `hidden … sm:flex`, so below 640px the site's two main destinations vanished with
   * nothing in their place — a visitor could reach الإقامات only by editing the URL.
   */
  test('the primary navigation is visible on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 850 });
    await page.goto('/ar');

    await expect(page.locator('header nav').first()).toBeVisible();
    await expect(page.locator('header nav').first().getByRole('link').first()) //
      .toBeVisible();
  });
});
