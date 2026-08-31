import { expect, test, type Page } from '@playwright/test';

import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';
import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';

/**
 * الإعدادات, driven the way an operator drives it.
 *
 * ## Why every one of these needs a browser
 *
 * The screen is seventeen rows that each save themselves, a filter that reaches across five cards,
 * and a popup that guards a switch. None of that is visible to `pnpm verify`: the unit tests can
 * see what `settingDisplay` returns and the integration tests can see what the API stores, and
 * between them sits everything a person actually meets.
 *
 * The defects these were written against were all found by USING the screen:
 *
 * - `10` beside «غرامة عدم الرد», with no currency anywhere on the row — the standing rule of
 *   2026-08-25 broken in the console rather than in a template.
 * - «تعديل» on the line ABOVE the label it belonged to at 390px, because the cell was `ms-auto`
 *   inside a wrapping flex row.
 * - «120 دقيقة» rendering as «دقيقة 120» when the figure and the unit are one string in an
 *   RTL line.
 *
 * ## Nothing here is left behind
 *
 * The switch tests CANCEL. Turning `rbac.finance_can_manage_fx` off revokes every session of that
 * role, and the suite shares one set of accounts — the lesson «any spec that submits the bar must
 * put the size back», learnt when a rows-per-page submit failed a default-size assertion a whole
 * run later. The one test that does save restores the value it changed before it ends.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);

test.use({ storageState: STAFF_STATE, viewport: { width: 1440, height: 900 } });

const row = (page: Page, key: string) => page.locator(`[data-setting-row="${key}"]`);

test.describe('الإعدادات — reading a value', () => {
  /**
   * No amount without its currency, asserted on the rows that ARE money.
   *
   * `no-bare-amounts.test.ts` sweeps the SOURCE for a `money()` with nothing beside it. It cannot
   * see this: the old screen printed `String(setting.value)` and never called `money()` at all, so
   * a sweep for that shape had nothing to find while «١٠» sat on the screen.
   */
  test('every money setting carries a currency', async ({ page }) => {
    await page.goto('/settings');

    for (const key of [
      'commission.customer_fee_value',
      'partner.first_violation_fine',
      'wallet.sla_compensation',
    ]) {
      const text = await row(page, key).innerText();

      /* A symbol or an ISO code — `amount()` picks per currency, so either is correct. */
      expect(text, `${key} shows a bare number`).toMatch(/\$|ل\.س|د\.أ|[A-Z]{3}/);
    }
  });

  /**
   * A unit, and the RIGHT WAY ROUND.
   *
   * «120 دقيقة» built as one string and set in a right-to-left line renders as «دقيقة 120»,
   * because the digits are a left-to-right run inside an RTL paragraph. The assertion is on the
   * painted GEOMETRY rather than on the string: the DOM reads correctly in both the broken and the
   * fixed version, which is exactly why this needed a browser.
   */
  test('a duration reads number-then-unit, not unit-then-number', async ({ page }) => {
    await page.goto('/settings');

    const minutes = row(page, 'booking.confirmation_window_minutes');

    await expect(minutes).toContainText('120');
    await expect(minutes).toContainText('دقيقة');

    const boxes = await minutes.evaluate((node) => {
      const walk = (element: Element): Element[] => [
        element,
        ...Array.from(element.children).flatMap(walk),
      ];

      const leaves = walk(node).filter((element) => element.children.length === 0);
      const find = (text: string) =>
        leaves.find((element) => (element.textContent ?? '').trim() === text);

      const figure = find('120');
      const unit = find('دقيقة');

      return figure && unit
        ? {
            figure: figure.getBoundingClientRect().left,
            unit: unit.getBoundingClientRect().left,
          }
        : null;
    });

    expect(boxes, 'the figure and the unit are not separate elements').not.toBeNull();
    /* Arabic reads right to left, so the figure sits to the RIGHT of its noun. */
    expect(boxes?.figure).toBeGreaterThan(boxes?.unit ?? 0);
  });

  test('an hour of the day reads as a time, and a rate as a percentage', async ({
    page,
  }) => {
    await page.goto('/settings');

    await expect(row(page, 'booking.same_day_cutoff_hour')).toContainText('17:00');

    const rate = row(page, 'commission.partner_rate');

    await expect(rate).toContainText(`7${t.percentSign}`);
    /* The fraction survives beside it: it is what the field and the audit row hold. */
    await expect(rate).toContainText('0.07');
  });

  test('a setting this form cannot validate says so, and offers no editor', async ({
    page,
  }) => {
    await page.goto('/settings');

    const routing = row(page, 'payment.provider_routing');

    await expect(routing).toContainText(t.sections.settings.readOnly);
    await expect(
      routing.getByRole('button', { name: t.sections.settings.change }),
    ).toHaveCount(0);
  });

  /**
   * The routing table scrolls INSIDE its own box.
   *
   * A pretty-printed JSON block is the one thing on this screen wide enough to push the page
   * sideways, which in this console takes the sidebar with it.
   */
  test('the routing table scrolls in its own box', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/settings');

    const overflow = await row(page, 'payment.provider_routing')
      .locator('pre')
      .evaluate((node) => getComputedStyle(node).overflowX);

    expect(overflow).toBe('auto');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  });
});

test.describe('الإعدادات — finding a setting', () => {
  test('the filter reaches across every card, and clearing restores them', async ({
    page,
  }) => {
    await page.goto('/settings');

    const rows = page.locator('[data-setting-row]');
    const all = await rows.count();

    expect(all).toBeGreaterThan(10);

    await page.getByRole('searchbox').fill('عمولة');
    await expect(rows).toHaveCount(1);

    /* The same row by its KEY — an engineer following a runbook searches for that, not for prose. */
    await page.getByRole('searchbox').fill('partner_rate');
    await expect(rows).toHaveCount(1);
    await expect(row(page, 'commission.partner_rate')).toBeVisible();

    /*
      A hamza the reader's keyboard habit drops. «الزامية» is «إلزامية» typed by a real person, and
      a filter that treats it as a miss is a filter that appears broken.
    */
    await page.getByRole('searchbox').fill('الزامية');
    await expect(row(page, 'compliance.sanctions_screening')).toBeVisible();

    await page.getByRole('button', { name: t.sections.settings.filterClear }).click();
    await expect(rows).toHaveCount(all);
  });

  test('a filter that matches nothing names what it searched for', async ({ page }) => {
    await page.goto('/settings');

    await page.getByRole('searchbox').fill('zzzz');

    await expect(page.locator('[data-setting-row]')).toHaveCount(0);
    await expect(page.locator('main')).toContainText('zzzz');
  });
});

test.describe('الإعدادات — changing a value', () => {
  /**
   * The one field whose unit differs from the unit the reader is thinking in.
   *
   * `0.7` for `0.07` passes the API's validation and multiplies every partner commission by ten.
   * The echo is the only place that becomes visible before it is saved.
   */
  test('the rate editor echoes the percentage while the fraction is typed', async ({
    page,
  }) => {
    await page.goto('/settings');

    const rate = row(page, 'commission.partner_rate');

    await rate.getByRole('button', { name: t.sections.settings.change }).click();

    const field = rate.locator('input[inputmode="decimal"]');

    await expect(field).toHaveValue('0.07');
    /* Focus moves to the field, so the editor is usable without reaching for the mouse. */
    await expect(field).toBeFocused();

    await field.fill('0.7');
    await expect(rate).toContainText(`70${t.percentSign}`);

    await rate.getByRole('button', { name: t.sections.settings.cancel }).click();
    await expect(field).toHaveCount(0);
    /* Cancelling leaves the value alone. */
    await expect(rate).toContainText(`7${t.percentSign}`);
  });

  /**
   * A switch asks first, and it asks with the console's OWN popup.
   *
   * `window.confirm` shows the reader the origin — «localhost:3001» — and answers in English,
   * which is the defect `packages/ui/src/one-dialog.test.ts` sweeps the source for. This asserts
   * the replacement is what actually appears, which the source sweep cannot.
   */
  test('a switch asks before it changes anything', async ({ page }) => {
    await page.goto('/settings');

    const usd = row(page, 'money.always_usd');
    const before = await usd.getByRole('switch').getAttribute('aria-checked');

    await usd.getByRole('switch').click();

    const dialog = page.getByRole('alertdialog');

    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(t.sections.settings.toggleTitle);

    /* Escape declines, and nothing was written. */
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(usd.getByRole('switch')).toHaveAttribute('aria-checked', before ?? '');
  });

  /**
   * The grants revoke sessions on the way DOWN, so that switch gets the danger tone.
   *
   * The colour is the visible half. The half that protects a person is the initial focus sitting
   * on «إلغاء», so somebody pressing Enter out of habit cancels rather than signing a whole role
   * out of their accounts.
   *
   * ## It TURNS THE GRANT ON first, rather than skipping when it is off
   *
   * The obvious shape — read the switch, skip if it is off — reports coverage it does not have:
   * the grant is off in a seeded database, so the danger path would never once be exercised and
   * the run would still be green. A test whose fixture cannot reach the thing it protects is worse
   * than no test. So it puts the switch where it needs it, checks the warning, and puts it back.
   */
  test('turning a grant off warns that sessions end, and focuses cancel', async ({
    page,
  }) => {
    await page.goto('/settings');

    const grant = row(page, 'rbac.finance_can_manage_fx');
    const grantSwitch = grant.getByRole('switch');
    const dialog = page.getByRole('alertdialog');
    const wasOn = (await grantSwitch.getAttribute('aria-checked')) === 'true';

    if (!wasOn) {
      await grantSwitch.click();
      await dialog.getByRole('button', { name: t.sections.dialog.confirm }).click();
      await expect(grantSwitch).toHaveAttribute('aria-checked', 'true');
    }

    await grantSwitch.click();

    /* The consequence, named: every session of that role ends, not "in fifteen minutes". */
    await expect(dialog).toContainText('جلسات');
    await expect(
      dialog.getByRole('button', { name: t.sections.dialog.cancel }),
    ).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(grantSwitch).toHaveAttribute('aria-checked', 'true');

    /* Back to whatever it was, because the suite shares one database. */
    if (!wasOn) {
      await grantSwitch.click();
      await dialog.getByRole('button', { name: t.sections.dialog.confirm }).click();
      await expect(grantSwitch).toHaveAttribute('aria-checked', 'false');
    }
  });

  /**
   * One real save, end to end, and put back.
   *
   * Everything above stops short of writing. This is the path that proves the row's own `fetch`,
   * the API's per-schema validation and `router.refresh()` agree with each other — and it restores
   * the value before it ends, because the suite shares one database.
   */
  test('saves one value and shows who changed it', async ({ page }) => {
    await page.goto('/settings');

    const nights = row(page, 'search.max_nights');

    await expect(nights).toContainText('90');

    await nights.getByRole('button', { name: t.sections.settings.change }).click();
    await nights.locator('input[inputmode="decimal"]').fill('89');
    await nights.getByRole('button', { name: t.sections.settings.save }).click();

    await expect(nights).toContainText('89');
    /* The row now names who changed it — the line is absent on a seeded default. */
    await expect(nights).toContainText('@');

    await nights.getByRole('button', { name: t.sections.settings.change }).click();
    await nights.locator('input[inputmode="decimal"]').fill('90');
    await nights.getByRole('button', { name: t.sections.settings.save }).click();

    await expect(nights).toContainText('90');
  });
});

/**
 * 390px, where the `auto-fit` grid this screen replaced put «تعديل» ABOVE its own label.
 *
 * The cell was `ms-auto` inside a wrapping flex row, so the button wrapped to the line before the
 * label rather than after it. Geometry is the only thing that can see that: the DOM order was
 * right the whole time.
 */
test.describe('الإعدادات on a phone', () => {
  test.use({ viewport: { width: 390, height: 900 } });

  test('a row’s action sits below its label, never above it', async ({ page }) => {
    await page.goto('/settings');

    const offenders = await page.evaluate(() => {
      const found: string[] = [];

      for (const element of Array.from(
        document.querySelectorAll<HTMLElement>('[data-setting-row]'),
      )) {
        const label = element.querySelector('p');
        const action = element.querySelector('button, [role="switch"]');

        if (!label || !action) continue;

        const labelTop = label.getBoundingClientRect().top;
        const actionTop = action.getBoundingClientRect().top;

        if (actionTop < labelTop) {
          found.push(
            `${element.dataset['settingRow']}: action ${actionTop} < label ${labelTop}`,
          );
        }
      }

      return found;
    });

    expect(offenders).toEqual([]);
  });

  test('every control on the screen is tall enough for a finger', async ({ page }) => {
    await page.goto('/settings');

    const small = await page.evaluate(() => {
      const found: string[] = [];

      for (const element of Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-setting-row] button, [data-setting-row] select',
        ),
      )) {
        const box = element.getBoundingClientRect();

        if (box.height > 0 && box.height < 40) {
          found.push(
            `${(element.textContent ?? 'switch').trim().slice(0, 20)} → ${box.height}`,
          );
        }
      }

      return found;
    });

    expect(small).toEqual([]);
  });
});
