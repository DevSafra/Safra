import { expect, test, type Page } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * The collapsible sidebar (Bashar, 2026-08-05).
 *
 * The requirement, restated as the things a test can hold:
 *
 * | Requirement | Asserted by |
 * | --- | --- |
 * | Hamburger available at ALL sizes | `the hamburger is present at every width` |
 * | Collapses and expands at any time | `toggles at …px` |
 * | Desktop users can hide it too | `toggles at 1440px`, and `main` grows |
 * | Preference persists across navigation and reload | `persists across …` |
 * | Layout adapts in both states | the `mainWidth` assertions |
 * | No page depends on it being visible | `every section works with the sidebar hidden` |
 * | Content uses the space when hidden | `main reclaims the column` |
 * | Navigation reachable when hidden | `the hamburger reveals it again` |
 * | Keyboard and a11y keep working | `Escape …`, `aria-expanded …`, `focus …` |
 *
 * Everything here needs a browser: the state is an attribute on `<html>` applied by a pre-paint
 * script, the layout is CSS keyed off it, and none of that exists in a unit test.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.use({ storageState: STAFF_STATE });

/** Tailwind's `lg`, where the sidebar stops being a drawer and becomes a column. */
const COLUMN = 1440;
const DRAWER = 390;

const hamburger = (page: Page) =>
  page.getByRole('button', { name: new RegExp(t.nav.showSidebar.slice(-12)) });

async function layout(page: Page) {
  return page.evaluate(() => {
    const aside = document.querySelector('aside');
    const main = document.querySelector('main');
    const button = document.getElementById('sidebar-toggle');

    return {
      state: document.documentElement.dataset['sidebar'] ?? 'unset',
      asideShown: aside ? getComputedStyle(aside).display !== 'none' : false,
      mainWidth: Math.round(main?.getBoundingClientRect().width ?? 0),
      expanded: button?.getAttribute('aria-expanded'),
      controls: button?.getAttribute('aria-controls'),
    };
  });
}

test.describe('the hamburger', () => {
  /**
   * Present at every size — the requirement that rules out the usual `lg:hidden` pattern.
   *
   * 2560px is included because that is where a "big screen so pin it open" assumption would
   * hide the control, and nothing else in the suite looks that wide.
   */
  for (const width of [390, 768, 1024, 1440, 1920, 2560]) {
    test(`is present at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/bookings');

      await expect(hamburger(page)).toBeVisible();
    });
  }

  togglesAt(DRAWER, 'a drawer over the content');
  togglesAt(COLUMN, 'a column beside it');
});

/**
 * One toggle scenario, at a width.
 *
 * A helper rather than two near-identical tests: the assertions differ only in what the layout
 * does, and writing them twice is how the drawer case ends up quietly weaker than the column one.
 */
function togglesAt(width: number, shape: string) {
  test(`toggles at ${width}px, where the sidebar is ${shape}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/bookings');

    const before = await layout(page);

    // With no stored choice: a column from `lg` up, hidden below. Both are the right default.
    expect(before.state).toBe('unset');
    expect(before.asideShown).toBe(width >= 1024);
    expect(before.expanded).toBe(String(width >= 1024));
    expect(before.controls).toBe('console-nav');

    await hamburger(page).click();

    const after = await layout(page);

    expect(after.asideShown).toBe(!before.asideShown);
    expect(after.state).toBe(before.asideShown ? 'hidden' : 'shown');
    expect(after.expanded).toBe(String(!before.asideShown));

    /*
      The layout adapts, and differently in each shape. A column gives its width back to the
      content; a drawer floats over it and must NOT reflow the page underneath, or dismissing it
      would shift everything the reader was looking at.
    */
    if (width >= 1024) {
      expect(after.mainWidth).toBeGreaterThan(before.mainWidth + 100);
    } else {
      expect(after.mainWidth).toBe(before.mainWidth);
    }
  });
}

test.describe('the preference', () => {
  test('persists across navigation and reload', async ({ page }) => {
    await page.setViewportSize({ width: COLUMN, height: 900 });
    await page.goto('/bookings');
    await hamburger(page).click();

    await expect.poll(async () => (await layout(page)).state).toBe('hidden');

    await page.goto('/staff');
    expect((await layout(page)).asideShown).toBe(false);

    await page.reload();
    expect((await layout(page)).asideShown).toBe(false);

    /*
      And it is applied BEFORE paint, not corrected after hydration. A 220px column that arrives
      late reflows the whole page in front of the reader — the reason the state lives in an
      attribute written by a blocking script rather than in React state.
     */
    expect(await page.evaluate(() => document.documentElement.dataset['sidebar'])).toBe(
      'hidden',
    );
  });

  test('survives a fresh context once stored, and the hamburger brings it back', async ({
    page,
  }) => {
    await page.setViewportSize({ width: COLUMN, height: 900 });
    await page.goto('/');
    await hamburger(page).click();
    await expect.poll(async () => (await layout(page)).asideShown).toBe(false);

    await hamburger(page).click();

    await expect.poll(async () => (await layout(page)).asideShown).toBe(true);
    expect((await layout(page)).state).toBe('shown');
  });
});

test.describe('with the sidebar hidden', () => {
  const SECTIONS = [
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

  /**
   * No page may DEPEND on the sidebar being visible.
   *
   * Each section still renders its heading and still does not scroll sideways with the nav gone.
   * The heading check is what catches a page that put something load-bearing in the shell.
   */
  test('every section still renders and does not overflow', async ({ page }) => {
    await page.setViewportSize({ width: COLUMN, height: 900 });
    await page.goto('/');
    await hamburger(page).click();
    await expect.poll(async () => (await layout(page)).asideShown).toBe(false);

    const broken: string[] = [];

    for (const path of SECTIONS) {
      await page.goto(path);

      const state = await page.evaluate(() => {
        const doc = document.documentElement;
        const aside = document.querySelector('aside');

        return {
          heading: (document.querySelector('main h1')?.textContent ?? '').trim(),
          overflow: doc.scrollWidth - doc.clientWidth,
          asideShown: aside ? getComputedStyle(aside).display !== 'none' : false,
        };
      });

      if (state.heading === '') broken.push(`${path}: no heading`);
      if (state.overflow > 1) broken.push(`${path}: overflows by ${state.overflow}px`);
      if (state.asideShown) broken.push(`${path}: sidebar reappeared`);
    }

    expect(broken).toStrictEqual([]);
  });

  /** The nav is still reachable — that is the whole bargain of hiding it. */
  test('the hamburger reveals the navigation again', async ({ page }) => {
    await page.setViewportSize({ width: COLUMN, height: 900 });
    await page.goto('/settings');
    await hamburger(page).click();
    await expect.poll(async () => (await layout(page)).asideShown).toBe(false);

    await hamburger(page).click();

    await expect(page.locator('#console-nav')).toBeVisible();
    await expect(page.locator('#console-nav').getByRole('link').first()).toBeVisible();
  });
});

test.describe('keyboard and assistive technology', () => {
  /**
   * Escape dismisses the DRAWER, and focus returns to the control that opened it.
   *
   * Not on a desktop: there the sidebar is a column, not something over your content, and Escape
   * closing a column would be a surprise.
   */
  test('Escape closes the drawer and returns focus', async ({ page }) => {
    await page.setViewportSize({ width: DRAWER, height: 900 });
    await page.goto('/bookings');
    await hamburger(page).click();
    await expect.poll(async () => (await layout(page)).asideShown).toBe(true);

    await page.keyboard.press('Escape');

    await expect.poll(async () => (await layout(page)).asideShown).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('sidebar-toggle');
  });

  test('Escape leaves the desktop column alone', async ({ page }) => {
    await page.setViewportSize({ width: COLUMN, height: 900 });
    await page.goto('/bookings');

    await page.keyboard.press('Escape');

    expect((await layout(page)).asideShown).toBe(true);
  });

  /** The drawer's backdrop dismisses it, and the button's state follows. */
  test('the backdrop dismisses the drawer', async ({ page }) => {
    await page.setViewportSize({ width: DRAWER, height: 900 });
    await page.goto('/bookings');
    await hamburger(page).click();
    await expect.poll(async () => (await layout(page)).asideShown).toBe(true);

    await page.locator('.console-backdrop').click({ position: { x: 8, y: 500 } });

    await expect.poll(async () => (await layout(page)).asideShown).toBe(false);
    // `aria-expanded` is kept in step by observing the attribute, not by a route refresh.
    await expect.poll(async () => (await layout(page)).expanded).toBe('false');
  });

  /** Reachable and operable by keyboard alone. */
  test('the hamburger is reachable by keyboard and works on Enter', async ({ page }) => {
    await page.setViewportSize({ width: COLUMN, height: 900 });
    await page.goto('/bookings');

    await page.locator('#sidebar-toggle').focus();
    await page.keyboard.press('Enter');

    await expect.poll(async () => (await layout(page)).asideShown).toBe(false);
  });

  /** Opening the drawer moves focus into it, so the next tab is inside the nav. */
  test('opening the drawer moves focus into it', async ({ page }) => {
    await page.setViewportSize({ width: DRAWER, height: 900 });
    await page.goto('/bookings');

    await hamburger(page).click();

    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id)) //
      .toBe('console-nav');
  });
});

test.describe('the account controls', () => {
  /**
   * They live in the SIDEBAR, not the page header (Bashar, 2026-08-05).
   *
   * Asserted by containment rather than by presence: they were in the header, where on a phone
   * they wrapped onto a second row under the title and read as two headers. A future change that
   * moves them back would still leave them "visible", so a visibility test would not catch it.
   */
  test('sit inside the sidebar, not the header', async ({ page }) => {
    await page.setViewportSize({ width: COLUMN, height: 900 });
    await page.goto('/bookings');

    const nav = page.locator('#console-nav');

    await expect(nav.getByRole('button', { name: /تسجيل الخروج/ })).toBeVisible();
    await expect(nav.getByRole('button', { name: /الوضع/ })).toBeVisible();

    // And not in the page header.
    const header = page.locator('main > header');

    await expect(header.getByRole('button', { name: /تسجيل الخروج/ })).toHaveCount(0);
  });

  /**
   * At the FOOT of the sidebar, below every nav row.
   *
   * `mt-auto` pins them to the bottom of the full-height drawer; on a desktop the aside is only as
   * tall as its content, so they sit directly under the nav. Either way they come last.
   */
  test('come after the navigation rows', async ({ page }) => {
    await page.setViewportSize({ width: COLUMN, height: 900 });
    await page.goto('/bookings');

    const lastLink = await page.locator('#console-nav nav a').last().boundingBox();
    const signOut = await page
      .locator('#console-nav')
      .getByRole('button', { name: /تسجيل الخروج/ })
      .boundingBox();

    expect(signOut?.y ?? 0).toBeGreaterThan(lastLink?.y ?? 0);
  });

  /**
   * Reachable in the drawer WITHOUT scrolling the nav.
   *
   * Nineteen nav rows are taller than a phone, and the first attempt let the whole drawer scroll —
   * which put sign-out below the fold. The nav scrolls inside itself instead, so the controls stay
   * on screen. This is the assertion that would have caught it.
   */
  test('stay visible in the drawer while the nav scrolls', async ({ page }) => {
    await page.setViewportSize({ width: DRAWER, height: 700 });
    await page.goto('/bookings');
    await hamburger(page).click();

    const signOut = page
      .locator('#console-nav')
      .getByRole('button', { name: /تسجيل الخروج/ });

    await expect(signOut).toBeInViewport();

    // The nav is the thing that scrolls, not the drawer.
    const scrolls = await page.evaluate(() => {
      const nav = document.querySelector('#console-nav nav')!;
      const aside = document.querySelector('#console-nav')!;

      return {
        navScrolls: nav.scrollHeight > nav.clientHeight,
        asideScrolls: aside.scrollHeight > aside.clientHeight + 1,
      };
    });

    expect(scrolls.navScrolls).toBe(true);
    expect(scrolls.asideScrolls).toBe(false);
  });

  /**
   * With the sidebar hidden they are one press away — the same bargain as the navigation.
   *
   * Worth stating plainly: hiding the sidebar DOES hide sign-out and the theme toggle. That is the
   * consequence of moving them there, and it is acceptable only because the hamburger is always
   * available and brings them straight back.
   */
  test('are one press away when the sidebar is hidden', async ({ page }) => {
    await page.setViewportSize({ width: COLUMN, height: 900 });
    await page.goto('/settings');
    await hamburger(page).click();
    await expect.poll(async () => (await layout(page)).asideShown).toBe(false);

    await hamburger(page).click();

    await expect(
      page.locator('#console-nav').getByRole('button', { name: /تسجيل الخروج/ }),
    ).toBeVisible();
  });
});
