import { expect, test, type Page } from '@playwright/test';

import { partnerAr as t } from '../packages/i18n/src/partner.js';
import { PARTNER_BASE as BASE, PARTNER_STATE } from './partner-session.js';

/**
 * لوحة الشريك's collapsible sidebar and theme toggle (Bashar, 2026-08-10).
 *
 * The ask was "the same as the staff console", so what is asserted here is the same set of
 * properties `sidebar.spec.ts` holds the console to, on the partner's four sections:
 *
 * | Requirement | Asserted by |
 * | --- | --- |
 * | Hamburger available at ALL sizes | `is present at every width …` |
 * | Collapses and expands at any time | `is a column at 1440px …`, `is a dismissible drawer …` |
 * | Content uses the space when hidden | the `mainWidth` assertions |
 * | Preference persists across navigation and reload | `… and the choice persists` |
 * | No page depends on it being visible | `every section still renders …` |
 * | Keyboard and a11y keep working | Escape, focus and `aria-expanded` in both shape tests |
 * | Theme toggle beside sign out, at the foot | `the account controls …` |
 *
 * Everything here needs a browser: the state is an attribute on `<html>` applied by a pre-paint
 * script, the layout is CSS keyed off it, and the palette is custom properties — none of which
 * exists in a unit test. This is the app whose sign-in was HTTP-green while unusable, twice.
 *
 * ## Why the assertions are grouped rather than one per test
 *
 * The API's default throttle is 120 requests a minute per IP, and every `page.goto` here costs the
 * partner profile plus the section's own data. Written as one test per assertion — twenty tests,
 * thirty-odd navigations — this spec exhausted that budget, and `partner.spec.ts`, which sorts
 * immediately after it and therefore inherits the emptiest budget in the run, got a 429 on
 * `GET /partner/me` and rendered a dashboard with no business name. The failure pointed at the
 * markup this change had just touched and had nothing to do with it.
 *
 * So assertions are grouped by the page load they SHARE, one test per shape of the sidebar, and the
 * widths are swept by resizing rather than reloading — the sidebar is an attribute and a media
 * query, so a resize exercises it exactly as a fresh load would. Raising the limiter instead was
 * not an option: it is a live control against credential stuffing, and the suite is the thing that
 * should bend.
 */

/**
 * The captured partner session, and a LIGHT operating-system preference.
 *
 * `colorScheme: 'light'` is not incidental: لوحة الشريك is designed dark and has no
 * `prefers-color-scheme` rule, so running under a light OS preference is what proves the dashboard
 * stays dark until somebody presses the button. Playwright's default follows whichever machine the
 * suite runs on, which would make that assertion pass or fail by accident.
 */
test.use({ storageState: PARTNER_STATE, colorScheme: 'light' });

/** Tailwind's `lg`, where the sidebar stops being a drawer and becomes a column. */
const COLUMN = 1440;
const DRAWER = 390;

/** §9.1 dark and §9.2 light backgrounds, written out so a palette edit fails the test. */
const DARK_BG = 'rgb(12, 10, 28)';
const LIGHT_BG = 'rgb(245, 246, 250)';

/**
 * Both sidebar labels end in «قائمة التنقل» — only the «إظهار»/«إخفاء» prefix flips.
 *
 * Matching the shared tail finds the button in either state, which a test that hard-coded
 * `showSidebar` does not: above `lg` the sidebar starts visible, so the button starts out saying
 * «إخفاء». Derived from the catalogue rather than written out, so it follows a copy edit.
 */
const NAV_LABEL = new RegExp(t.nav.showSidebar.slice(-12));

/**
 * The hamburger, located by id rather than by accessible name.
 *
 * The backdrop carries the SAME «إخفاء قائمة التنقل» label — deliberately, it does the same thing —
 * so a name-based locator matches two elements the moment the drawer is open, and every assertion
 * becomes a strict-mode violation rather than a result. The labelling is asserted separately,
 * scoped to the header, where the backdrop cannot reach.
 */
const hamburger = (page: Page) => page.locator('#sidebar-toggle');

const header = (page: Page) => page.locator('main > header');

const sidebar = (page: Page) => page.locator('#partner-nav');

const signOut = (page: Page) =>
  sidebar(page).getByRole('button', { name: t.nav.signOut });

const themeToggle = (page: Page) =>
  page.getByRole('button', { name: t.nav.themeToLight });

const bodyBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

async function layout(page: Page) {
  return page.evaluate(() => {
    const aside = document.getElementById('partner-nav');
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

/**
 * The desktop shape: a column the partner can put away, and the account controls at its foot.
 *
 * The account controls are asserted here rather than in a test of their own because they need the
 * same page load, and containment is what makes the assertion meaningful: they were in the page
 * header on the console, where on a phone they wrapped under the title and read as two headers.
 * A change that moved them back would leave them "visible", so a visibility test would not catch it.
 */
test('the sidebar is a column at 1440px that the hamburger puts away', async ({
  page,
}) => {
  await page.setViewportSize({ width: COLUMN, height: 900 });
  await page.goto(`${BASE}/properties`);

  const before = await layout(page);

  // With no stored choice: a column from `lg` up. Nobody has pressed anything yet.
  expect(before.state).toBe('unset');
  expect(before.asideShown).toBe(true);
  expect(before.expanded).toBe('true');
  expect(before.controls).toBe('partner-nav');

  // The label names the ACTION, so it says which way the button goes.
  await expect(
    header(page).getByRole('button', { name: t.nav.hideSidebar }),
  ).toBeVisible();

  /*
    Escape leaves a COLUMN alone. It is not something over your content, and Escape closing a
    column would be a surprise — the key means "dismiss the thing covering what I was reading".
  */
  await page.keyboard.press('Escape');
  expect((await layout(page)).asideShown).toBe(true);

  // The account controls: at the foot of the sidebar, beside each other, not in the header.
  await expect(signOut(page)).toBeVisible();
  await expect(
    sidebar(page).getByRole('button', { name: t.nav.themeToLight }),
  ).toBeVisible();
  await expect(header(page).getByRole('button', { name: t.nav.signOut })).toHaveCount(0);

  const lastLink = await sidebar(page).locator('nav a').last().boundingBox();
  const signOutBox = await signOut(page).boundingBox();
  const toggleBox = await themeToggle(page).boundingBox();

  // Below every nav row…
  expect(signOutBox?.y ?? 0).toBeGreaterThan(lastLink?.y ?? 0);

  // …and on the SAME row as each other: their vertical centres agree within a couple of pixels.
  const toggleCentre = (toggleBox?.y ?? 0) + (toggleBox?.height ?? 0) / 2;
  const signOutCentre = (signOutBox?.y ?? 0) + (signOutBox?.height ?? 0) / 2;

  expect(Math.abs(toggleCentre - signOutCentre)).toBeLessThan(3);

  await hamburger(page).click();

  const hidden = await layout(page);

  expect(hidden.asideShown).toBe(false);
  expect(hidden.state).toBe('hidden');
  expect(hidden.expanded).toBe('false');
  // The content takes the column back — the whole point of letting a desktop hide it.
  expect(hidden.mainWidth).toBeGreaterThan(before.mainWidth + 100);

  await expect(
    header(page).getByRole('button', { name: t.nav.showSidebar }),
  ).toBeVisible();

  // And back again, so "collapses and expands at any time" holds in both directions.
  await hamburger(page).click();

  const shown = await layout(page);

  expect(shown.asideShown).toBe(true);
  expect(shown.state).toBe('shown');
  expect(shown.mainWidth).toBe(before.mainWidth);
});

/**
 * The handheld shape: an overlay drawer, dismissed by Escape or by tapping outside.
 *
 * Note what is NOT asserted — pressing the hamburger a second time to close it. The open drawer
 * covers the header at 390px, so the hamburger is underneath it and genuinely unclickable; that is
 * true of the console too, and it is why a drawer owes the reader a backdrop and an Escape key. A
 * test that clicked the hamburger twice here would fail against correct behaviour.
 */
test('the sidebar is a dismissible drawer at 390px', async ({ page }) => {
  await page.setViewportSize({ width: DRAWER, height: 700 });
  await page.goto(`${BASE}/properties`);

  const before = await layout(page);

  // Hidden below `lg` with no stored choice — a phone has no room for a 220px column.
  expect(before.state).toBe('unset');
  expect(before.asideShown).toBe(false);
  expect(before.expanded).toBe('false');

  await hamburger(page).click();

  const open = await layout(page);

  expect(open.asideShown).toBe(true);
  expect(open.state).toBe('shown');
  expect(open.expanded).toBe('true');

  /*
    A drawer floats OVER the content and must not reflow the page underneath it, or dismissing it
    would shift everything the reader was looking at.
  */
  expect(open.mainWidth).toBe(before.mainWidth);

  // Opening it moves focus INTO it, so the next tab lands on a nav link rather than on nothing.
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id)) //
    .toBe('partner-nav');

  /*
    The account controls are reachable in the drawer without scrolling the nav. `mt-auto` pins them
    to the bottom of the full-height drawer and the nav scrolls inside itself, so a longer nav
    cannot push them below the fold — the failure the console hit when the whole aside scrolled.
  */
  await expect(signOut(page)).toBeInViewport();
  await expect(themeToggle(page)).toBeInViewport();

  /*
    A nav row is still the height of a nav row.

    This caught a real defect. The nav is `flex-1` so it fills the drawer, and a GRID with free
    space distributes it across its rows — so لوحة الشريك's four items came out as four 180px slabs
    in a full-height drawer, while the console's twenty rows overflow and never showed it. Fixed
    with `content-start`; asserted here because it is invisible to every other kind of test and the
    partner nav will stay short.

    The COUNT is a floor, not an equality. This asserted exactly four and broke the moment التقويمات
    became a fifth nav item — a test failing because the navigation grew is a test about the wrong
    thing. What matters is that a row is row-height whatever the count.
  */
  const rowHeights = await page.evaluate(() =>
    // `Array.from`, as the rest of the suite does: `e2e/tsconfig.json` sets `lib` to ES2023 + DOM
    // without `DOM.Iterable`, so SPREADING a NodeList widens it to `any[]` and the project forbids
    // an unchecked call on one.
    Array.from(document.querySelectorAll<HTMLElement>('#partner-nav nav a')).map((row) =>
      Math.round(row.getBoundingClientRect().height),
    ),
  );

  expect(rowHeights.length).toBeGreaterThanOrEqual(4);
  expect(Math.max(...rowHeights)).toBeLessThan(60);

  await page.keyboard.press('Escape');

  await expect.poll(async () => (await layout(page)).asideShown).toBe(false);
  // Focus returns to the control that opened it, rather than being lost to the top of the document.
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('sidebar-toggle');

  // Re-open — the hamburger is reachable again now the drawer is gone — and tap outside instead.
  await hamburger(page).click();
  await expect.poll(async () => (await layout(page)).asideShown).toBe(true);

  await page.locator('.portal-backdrop').click({ position: { x: 8, y: 500 } });

  await expect.poll(async () => (await layout(page)).asideShown).toBe(false);
  // `aria-expanded` is kept in step by observing the attribute, not by a route refresh.
  await expect.poll(async () => (await layout(page)).expanded).toBe('false');
});

/**
 * The hamburger exists at every width, and the choice outlives the page.
 *
 * 1920 is in the sweep because that is where a "big screen, so pin it open" assumption would hide
 * the control, and nothing else in this spec looks that wide. The sweep does not press anything, so
 * the stored state is still unset when the persistence half begins.
 */
test('the hamburger is present at every width, and the choice persists', async ({
  page,
}) => {
  await page.goto(`${BASE}/properties`);

  const missing: number[] = [];

  for (const width of [DRAWER, 768, 1024, COLUMN, 1920]) {
    await page.setViewportSize({ width, height: 900 });

    if (!(await header(page).getByRole('button', { name: NAV_LABEL }).isVisible())) {
      missing.push(width);
    }
  }

  expect(missing).toStrictEqual([]);

  await page.setViewportSize({ width: COLUMN, height: 900 });
  await hamburger(page).click();
  await expect.poll(async () => (await layout(page)).state).toBe('hidden');

  // Across a navigation…
  await page.goto(`${BASE}/payouts`);
  expect((await layout(page)).asideShown).toBe(false);

  // …and across a reload.
  await page.reload();
  expect((await layout(page)).asideShown).toBe(false);

  /*
    And applied BEFORE paint, not corrected after hydration. A 220px column that arrives late
    reflows the whole page in front of the reader, which is why the state lives in an attribute
    written by a blocking script rather than in React state.
  */
  expect(await page.evaluate(() => document.documentElement.dataset['sidebar'])).toBe(
    'hidden',
  );
});

/**
 * No page may DEPEND on the sidebar being visible.
 *
 * Each section still renders its heading and still does not scroll sideways with the nav gone. The
 * heading check is what catches a page that put something load-bearing in the shell.
 *
 * The sidebar is hidden on the first section and stays hidden for the rest, so this costs four page
 * loads rather than five.
 */
test('every section still renders and does not overflow with the sidebar hidden', async ({
  page,
}) => {
  await page.setViewportSize({ width: COLUMN, height: 900 });
  await page.goto(`${BASE}/`);
  await hamburger(page).click();
  await expect.poll(async () => (await layout(page)).asideShown).toBe(false);

  const broken: string[] = [];

  for (const path of ['/', '/properties', '/payouts', '/reviews']) {
    // `/` is already open with the sidebar hidden; the rest are visited in turn.
    if (path !== '/') await page.goto(`${BASE}${path}`);

    const state = await page.evaluate(() => {
      const doc = document.documentElement;
      const aside = document.getElementById('partner-nav');

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

/**
 * The theme toggle: dark despite a light OS preference, switching, relabelling, and remembered.
 *
 * The CSP listener is armed for the whole test rather than given a page load of its own. A blocked
 * pre-paint script reports as a console error and nothing else — the page renders, the toggle still
 * works, and only the flash on load betrays it — and this app signs that script with a per-request
 * nonce, so a wrong nonce is a real failure mode rather than a theoretical one.
 */
test('the theme toggle switches, relabels, and is remembered', async ({ page }) => {
  const violations: string[] = [];

  page.on('console', (message) => {
    const text = message.text();
    if (/content security policy|refused to execute/i.test(text)) violations.push(text);
  });

  await page.setViewportSize({ width: COLUMN, height: 900 });
  await page.goto(`${BASE}/properties`);

  // Dark despite `colorScheme: 'light'` above — the dashboard is opt-in, not OS-driven.
  await expect(bodyBackground(page)).resolves.toBe(DARK_BG);
  /*
    The icon names the DESTINATION, like the label — dark offers the sun (Bashar, 2026-08-19).

    Held by the icon rather than through `themeToggle()`, whose locator is the button's accessible
    NAME: that name changes when the button is pressed, so the same handle would stop matching
    exactly when the second assertion needs it.
  */
  const themeIcon = page.locator('aside [data-theme-icon]');

  await expect(themeIcon).toHaveAttribute('data-theme-icon', 'sun');

  await themeToggle(page).click();

  await expect(bodyBackground(page)).resolves.toBe(LIGHT_BG);
  // The button reports where it goes, so its name changes with the state.
  await expect(page.getByRole('button', { name: t.nav.themeToDark })).toBeVisible();
  await expect(themeIcon).toHaveAttribute('data-theme-icon', 'moon');

  await page.reload();

  await expect(bodyBackground(page)).resolves.toBe(LIGHT_BG);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  expect(violations).toStrictEqual([]);
});
