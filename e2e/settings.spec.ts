import { expect, test, type Page } from '@playwright/test';

import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';
import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { ADMIN_DISPLAY_NAME } from '../packages/contracts/src/actor.js';

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

/*
  The catalogue's loose maps index to `string | undefined` under `noUncheckedIndexedAccess`, and a
  test must not paper over that with `!`: a missing entry should fail loudly here, not compare
  against `undefined` and pass.
*/
const named = (map: Record<string, string>, key: string): string => {
  const value = map[key];

  if (!value) throw new Error(`the catalogue has no entry for ${key}`);

  return value;
};

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
   * It is the one thing on this screen wide enough to push the page sideways, which in this console
   * takes the sidebar with it. It was a pretty-printed JSON block and is a two-column table now —
   * the assertion is on the BOX either way, because that is the property that matters.
   */
  test('the routing table scrolls in its own box', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/settings');

    const overflow = await row(page, 'payment.provider_routing')
      .locator('table')
      .evaluate((node) => {
        const box = node.parentElement;

        return box ? getComputedStyle(box).overflowX : 'no box';
      });

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

    /*
      The row now names who changed it — the line is absent on a seeded default.

      «Admin», not an address: `SETTINGS_UPDATE` is super admin only, so every actor a settings
      read can return is one, and the pseudonym rule of 2026-08-23 says that account is shown by
      its platform name. Both queries selected `u.email` raw until 2026-08-31, which printed the
      owner's address to every operations user on every row that had ever been changed.
    */
    await expect(nights).toContainText(ADMIN_DISPLAY_NAME);
    await expect(nights).not.toContainText('@');

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

/**
 * «All texts on the page should be written in the current language» — Bashar, 2026-08-31.
 *
 * The console is Arabic-only, and the screen was carrying four kinds of English at once: the raw
 * setting key under every label, «نوع string» and «نوع json» (the names of Zod schemas), the
 * payment routing table as `{"*":["manual_transfer"],"SY":[…]}`, and «مهلة Pending Payment» inside
 * a seeded Arabic sentence.
 *
 * This is the CLASS, not the four instances: no element on the screen may have a machine
 * identifier as its whole text. `e2e/navigation.spec.ts` sweeps for bare `lower_snake_case` across
 * every section and cannot see a DOTTED key — `commission.partner_rate` passes it — which is
 * exactly why eighteen of them sat there unnoticed.
 */
test.describe('الإعدادات is written in Arabic', () => {
  test('no machine identifier reaches the reading flow', async ({ page }) => {
    await page.goto('/settings');

    const identifiers = await page.evaluate(() => {
      const found: string[] = [];

      for (const element of Array.from(document.querySelectorAll('main *'))) {
        if (element.children.length > 0) continue;

        const text = (element.textContent ?? '').trim();

        /*
          A lower-case Latin run joined by dots or underscores is a key, a slug or a schema name —
          there is nothing else it can be. Capitalised Latin is left alone: «Safra Technologies
          GmbH» is a legal entity's name and «Visa» is a brand, and neither translates.
        */
        if (text && /^[a-z][a-z0-9_.]*$/.test(text)) found.push(text);
      }

      return found;
    });

    expect(identifiers).toEqual([]);
  });

  /**
   * The routing table, as rows.
   *
   * The country comes from `Intl.DisplayNames` and the rail from the catalogue, so «سوريا» and
   * «تحويل بنكي يدوي» replace `SY` and `manual_transfer`. Asserted through the rendered table
   * rather than the source, because the fallback is a pretty-printed JSON block and the difference
   * between the two is invisible to a type.
   */
  test('the payment routing table reads as country and rail, not as JSON', async ({
    page,
  }) => {
    await page.goto('/settings');

    const routing = row(page, 'payment.provider_routing');

    await expect(routing.locator('table')).toBeVisible();
    await expect(routing.locator('pre')).toHaveCount(0);

    const table = await routing.locator('table').innerText();

    expect(table).toContain(t.sections.settings.routingCountry);
    expect(table).toContain('سوريا');
    expect(table).toContain(named(t.sections.settings.providers, 'manual_transfer'));
    expect(table).toContain(t.sections.settings.routingFallback);
    /* Nothing Latin survives in it — that was the complaint. */
    expect(table).not.toMatch(/manual_transfer|"SY"/);
  });

  /** The two unrelated subjects that used to share «إعدادات أخرى» now have their own cards. */
  test('compliance and payment are their own sections, not «other»', async ({ page }) => {
    await page.goto('/settings');

    const headings = await page.locator('main section h2').allTextContents();

    expect(headings).toContain(t.sections.settings.groupCompliance);
    expect(headings).toContain(t.sections.settings.groupPayment);

    /* And the rows are inside them rather than in the drawer they came from. */
    const compliance = page.locator('section').filter({
      has: page.getByRole('heading', { name: t.sections.settings.groupCompliance }),
    });

    await expect(
      compliance.locator('[data-setting-row="compliance.sanctions_screening"]'),
    ).toBeVisible();
  });
});

/**
 * «التفاصيل» — the key, the value's type, and the change history.
 *
 * `settings_history` is written inside the same transaction as every setting change and, until
 * 2026-08-31, could not be read anywhere: the API route existed and nothing called it. The table's
 * whole reason for being is that a March booking's snapshot says the fee was 1.99 and only this
 * says when that stopped being true.
 */
test.describe('الإعدادات — the details drawer', () => {
  test('holds the technical key and the type, in Arabic', async ({ page }) => {
    await page.goto('/settings');

    const rate = row(page, 'commission.partner_rate');

    /* Closed by default: the key is an identifier, not part of the reading flow. */
    await expect(rate).not.toContainText('commission.partner_rate');

    await rate.getByRole('button', { name: t.sections.settings.details }).click();

    await expect(rate).toContainText(t.sections.settings.technicalKey);
    await expect(rate).toContainText('commission.partner_rate');
    await expect(rate).toContainText(named(t.sections.settings.valueTypes, 'rate'));

    await rate.getByRole('button', { name: t.sections.settings.detailsHide }).click();
    await expect(rate).not.toContainText('commission.partner_rate');
  });

  test('says so plainly when a setting has never been changed', async ({ page }) => {
    await page.goto('/settings');

    const fee = row(page, 'commission.customer_fee_mode');

    await fee.getByRole('button', { name: t.sections.settings.details }).click();

    await expect(fee).toContainText(t.sections.settings.historyTitle);
    await expect(fee).toContainText(t.sections.settings.historyEmpty);
  });

  /**
   * A change, then the log that records it — with the unit on both sides.
   *
   * «من 89 ليلة إلى 90 ليلة», never «من 89 إلى 90». A change log is a payload a person reads, so
   * the rule that holds `audit_log.after` and `timeline_events.payload` holds this too.
   *
   * Restores the value before it ends: the suite shares one database.
   */
  test('records a change and reads it back with its unit', async ({ page }) => {
    await page.goto('/settings');

    const nights = row(page, 'search.max_nights');

    await nights.getByRole('button', { name: t.sections.settings.change }).click();
    await nights.locator('input[inputmode="decimal"]').fill('88');
    await nights.locator('input[name="reason"]').fill('فحص المتصفح');
    await nights.getByRole('button', { name: t.sections.settings.save }).click();

    await expect(nights).toContainText('88');

    await nights.getByRole('button', { name: t.sections.settings.details }).click();

    await expect(nights).toContainText(t.sections.settings.historyTitle);
    /* The reason travelled with the change. */
    await expect(nights).toContainText('فحص المتصفح');
    /* And the entry names the unit, not two bare numbers. */
    await expect(nights.locator('ol')).toContainText('ليلة');
    await expect(nights.locator('ol').first()).toContainText('88');

    await nights.getByRole('button', { name: t.sections.settings.detailsHide }).click();
    await nights.getByRole('button', { name: t.sections.settings.change }).click();
    await nights.locator('input[inputmode="decimal"]').fill('90');
    await nights.getByRole('button', { name: t.sections.settings.save }).click();

    await expect(nights).toContainText('90');
  });
});
