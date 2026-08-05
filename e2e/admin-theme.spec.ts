import { expect, test, type Page } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * The staff console's light/dark toggle (Bashar, 2026-08-04).
 *
 * ## Why this needs a browser
 *
 * Every part of the feature is invisible to `pnpm verify`. The palette is CSS custom properties,
 * so only a computed style says whether it applied. The pre-paint script is an inline `<script>`
 * that a Content-Security-Policy can block — and when it does, the page still works and the only
 * symptom is a flash of the wrong theme on every load. This console has already shipped a CSP
 * that blocked every hydration script while two HTTP-level suites passed green.
 *
 * ## Colours asserted as rgb, from the handoff
 *
 * `#0C0A1C` → `rgb(12, 10, 28)` and `#F5F6FA` → `rgb(245, 246, 250)`, both §9.1/§9.2 verbatim.
 * Written out rather than computed from the CSS so the test fails if somebody edits the palette
 * to something the handoff does not specify.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);

/**
 * The captured staff session, and a LIGHT operating-system preference.
 *
 * `colorScheme: 'light'` is not incidental — it is the case that first broke this suite. The
 * console must stay dark until somebody presses the button, so running every test under a light
 * OS preference is what proves the console ignores it. Playwright's default follows the machine
 * the suite happens to run on, which would make these assertions pass or fail by accident.
 */
test.use({ storageState: STAFF_STATE, colorScheme: 'light' });

const DARK_BG = 'rgb(12, 10, 28)';
const LIGHT_BG = 'rgb(245, 246, 250)';

/** The dark and light golds. Proves the `*A` alpha triples were overridden, not just `--color-*`. */
const DARK_GOLD = 'rgb(232, 188, 102)';
const LIGHT_GOLD = 'rgb(168, 122, 31)';

const bodyBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const goldToken = (page: Page) =>
  page.evaluate(() => {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-gold')
      .trim();

    // Normalise the hex the stylesheet declares into the rgb() the assertions use.
    const probe = document.createElement('span');
    probe.style.color = raw;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();

    return resolved;
  });

const toggle = (page: Page) =>
  page.getByRole('button', { name: t.dashboard.themeToLight });

test.describe('the console theme toggle', () => {
  test('starts dark and switches to light', async ({ page }) => {
    await page.goto('/');

    // Dark despite `colorScheme: 'light'` above — the console is opt-in, not OS-driven.
    await expect(bodyBackground(page)).resolves.toBe(DARK_BG);
    await expect(goldToken(page)).resolves.toBe(DARK_GOLD);

    await toggle(page).click();

    await expect(bodyBackground(page)).resolves.toBe(LIGHT_BG);

    /**
     * The alpha triple, not just the colour token.
     *
     * Roughly forty rules compose a tint with `rgba(var(--goldA), .12)`. Overriding only the
     * `--color-*` set leaves every tinted badge, hairline and surface reading as the dark
     * theme's gold over a white card — which looks like a rendering bug rather than a theme.
     */
    await expect(goldToken(page)).resolves.toBe(LIGHT_GOLD);
  });

  /** The button reports where it goes, so its name changes with the state. */
  test('relabels itself once light is active', async ({ page }) => {
    await page.goto('/');
    await toggle(page).click();

    await expect(
      page.getByRole('button', { name: t.dashboard.themeToDark }),
    ).toBeVisible();
  });

  /**
   * The choice survives a reload, applied BEFORE paint.
   *
   * If the inline script were CSP-blocked, or moved into an effect, this would still end up
   * light — after a visible flash of dark. So the assertion is paired with the console check
   * below, which is what actually catches a blocked script.
   */
  test('remembers the choice across a reload', async ({ page }) => {
    await page.goto('/');
    await toggle(page).click();
    await expect(bodyBackground(page)).resolves.toBe(LIGHT_BG);

    await page.reload();

    await expect(bodyBackground(page)).resolves.toBe(LIGHT_BG);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  /**
   * The pre-paint script must not be refused by the Content-Security-Policy.
   *
   * A blocked inline script reports as a console error and nothing else — the page renders, the
   * toggle still works, and only the flash on load betrays it. This is the assertion that would
   * have caught it.
   */
  test('the pre-paint script is not blocked by the CSP', async ({ page }) => {
    const violations: string[] = [];

    page.on('console', (message) => {
      const text = message.text();
      if (/content security policy|refused to execute/i.test(text)) violations.push(text);
    });

    await page.goto('/');
    await page.reload();

    expect(violations).toStrictEqual([]);
  });

  /**
   * Present on the other eighteen sections too, not only the dashboard.
   *
   * The dashboard renders its own header; every other section uses `ConsoleShell`. A toggle on
   * one and not the other is a control that vanishes when you navigate.
   */
  test('is present on a section that uses the shared shell', async ({ page }) => {
    await page.goto('/bookings');

    await expect(toggle(page)).toBeVisible();
    await toggle(page).click();
    await expect(bodyBackground(page)).resolves.toBe(LIGHT_BG);
  });

  /** Text has to stay legible: the light theme's ink, not the dark theme's cream. */
  test('switches the text colour as well as the background', async ({ page }) => {
    await page.goto('/');

    const ink = () => page.evaluate(() => getComputedStyle(document.body).color);

    await expect(ink()).resolves.toBe('rgb(244, 238, 223)');

    await toggle(page).click();

    await expect(ink()).resolves.toBe('rgb(29, 35, 51)');
  });
});
