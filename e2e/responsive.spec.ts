import { expect, test, type Page } from '@playwright/test';

import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';
import { PARTNER_BASE } from './partner-session.js';

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
  /*
    The legal pages, added 2026-08-14. Long-form prose in a right-to-left column is exactly where a
    fixed measure or an unwrapped Latin token (`safra_session`, `Argon2id`) pushes a page sideways,
    and both are things these documents necessarily contain.
  */
  '/ar/terms',
  '/ar/privacy',
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
 * Can a component ask for a control TALLER than the floor and get it?
 *
 * Bashar, 2026-09-02: «the menu items on the navbar is a little bit under the logo with height.»
 * The header's controls carried `sm:min-h-11` and rendered 40px anyway, so the 44px brand mark sat
 * two pixels above a row of 40px items. Not specificity — a class beats `:where()`, which is zero.
 * **An UNLAYERED rule beats every layered one whatever the specificity**, and `@import 'tailwindcss'`
 * puts utilities in `@layer utilities`, so the floor — written outside any layer — won against every
 * height a component asked for below `lg`.
 *
 * It reached four more screens than the one that was reported: on a phone the search form's «بحث»
 * button and both of its popover triggers ask for 48px and rendered 40, beside الوجهة, which is a
 * `div` and got the 48px it asked for.
 *
 * ## Why a probe rather than a screen
 *
 * The defect is a property of the CASCADE, not of any one component, and asserting it through a
 * component would make this test fail the day that component changes its height for a good reason.
 * The probe declares a height from inside `@layer utilities` — exactly where every Tailwind utility
 * lives — and asks what the element ended up with. Layered, the floor loses and the answer is 44px;
 * unlayered, it wins and the answer is 40px, which is the bug.
 *
 * It does not name a utility CLASS on purpose: `min-h-11` is emitted only into the stylesheets of
 * apps that use it, so a class-based probe would report the defect in any app that happens not to
 * have reached for that height yet.
 */
async function raisableFloor(page: Page) {
  return page.evaluate(() => {
    const style = document.createElement('style');

    style.textContent = '@layer utilities { #floor-probe { min-height: 2.75rem } }';

    const probe = document.createElement('button');

    probe.id = 'floor-probe';

    document.head.append(style);
    document.body.append(probe);

    const resolved = getComputedStyle(probe).minHeight;

    probe.remove();
    style.remove();

    return resolved;
  });
}

/**
 * Can a grid or flex child ask for a WIDTH floor and get it?
 *
 * The twin of `raisableFloor`, and the same defect in a second property. `globals.css` carries
 * `:where(.grid, .flex, .inline-flex) > * { min-width: 0 }` so no panel has to remember `min-w-0`,
 * and it was written outside any cascade layer — which beats every Tailwind utility whatever the
 * specificity says. The note beside it claimed «any explicit `min-w-*` still wins» and had been
 * false since Tailwind v4 landed.
 *
 * It was not theoretical. The shared image previewer's controls asked for `min-w-10`/`min-h-10` and
 * rendered **30×23px** — under WCAG 2.5.8's 24×24 floor, on a modal dialog, in all three apps. A
 * previous session met the same defect on الإعلانات, measured it correctly, and worked around it
 * with a two-column grid instead of fixing the rule.
 *
 * The probe declares a width from inside `@layer utilities`, on a flex child, which is exactly where
 * the real rule bites. Not phrased against a utility CLASS, for the reason `raisableFloor` gives.
 */
async function raisableWidthFloor(page: Page) {
  return page.evaluate(() => {
    const style = document.createElement('style');

    style.textContent = '@layer utilities { #width-probe { min-width: 2.75rem } }';

    const row = document.createElement('div');

    row.className = 'flex';
    row.style.width = '0px';

    const probe = document.createElement('button');

    probe.id = 'width-probe';
    row.append(probe);

    document.head.append(style);
    document.body.append(row);

    const resolved = getComputedStyle(probe).minWidth;

    row.remove();
    style.remove();

    return resolved;
  });
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

  /**
   * A DETAIL screen, which the sweep above cannot reach.
   *
   * `CONSOLE` is a list of static paths and every detail route needs a live reference, so no
   * record had ever been requested at any width — the same blind spot the property page's
   * breadcrumb sat in until 2026-08-12. The customer record is the widest of them: six sections,
   * each a row of a name, a truncating middle, a status pill and a timestamp, which is exactly the
   * shape that stops wrapping and pushes a page sideways.
   *
   * One test over all the widths rather than one per width: it resolves the reference once and the
   * whole point is the comparison across sizes.
   */
  test('a customer record scrolls sideways at no width', async ({ page }) => {
    await page.goto('/customers?size=5');

    const href = await page
      .locator('tbody a[href^="/customers/CUS-"]')
      .first()
      .getAttribute('href');

    expect(href, 'a customer to open').not.toBeNull();

    const broken: string[] = [];

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(href ?? '');

      const result = await overflow(page);

      if (result) broken.push(`${width}px ${result}`);
    }

    expect(broken).toStrictEqual([]);
  });

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

  test('a control may declare a height above the floor', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/bookings');

    expect(await raisableFloor(page)).toBe('44px');
  });

  test('a flex child may declare a width floor', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/bookings');

    expect(await raisableWidthFloor(page)).toBe('44px');
  });

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
   * twenty nav links pushed every section below the fold. Then it moved below the content in the
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

  test('a control may declare a height above the floor', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/ar');

    expect(await raisableFloor(page)).toBe('44px');
  });

  test('a flex child may declare a width floor', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/ar');

    expect(await raisableWidthFloor(page)).toBe('44px');
  });

  /**
   * And the لوحة الشريك, whose `globals.css` carried the same rule.
   *
   * Its sign-in screen, which needs no session — this spec runs in the project that has none. The
   * portal is a third copy of the floor and a fix applied to two of three files is the shape that
   * leaves a defect live on the screen nobody was looking at.
   */
  test('a control may declare a height above the floor in the partner portal', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`${PARTNER_BASE}/login`);

    expect(await raisableFloor(page)).toBe('44px');
    expect(await raisableWidthFloor(page)).toBe('44px');
  });

  /**
   * The header row has ONE top edge and ONE bottom edge.
   *
   * What Bashar actually saw. The brand mark is 44px and every control beside it was 40px, so on a
   * row centred about a common axis the brand's box began two pixels higher than the menu's — brand
   * at y=20, menu at y=22, measured. The text baselines were identical to a tenth of a pixel; it
   * was the BOXES that differed, which is the half nobody thinks to check.
   *
   * From `sm` up, where the bar is one row. Below it the header wraps deliberately — five items
   * come to 551px against 358px of a 390px phone — and a row-sharing assertion there would be
   * asserting that it does not wrap.
   */
  for (const width of [768, 1024, 1440]) {
    test(`the header is one row with one top edge at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      await page.goto('/ar');

      const edges = await page.evaluate(() => {
        const bar = document.querySelector('header')?.firstElementChild;

        return Array.from(bar?.children ?? [])
          .map((element) => element.getBoundingClientRect())
          .filter((box) => box.height > 0)
          .map((box) => `${Math.round(box.top)}/${Math.round(box.bottom)}`);
      });

      expect(edges.length).toBeGreaterThan(3);
      expect(new Set(edges).size, `distinct edges: ${edges.join(' ')}`).toBe(1);
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
