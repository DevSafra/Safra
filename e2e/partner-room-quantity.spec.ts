import { expect, test } from '@playwright/test';

import { PARTNER_BASE, PARTNER_STATE } from './partner-session.js';

/*
  A listing that is EDITABLE. Only some statuses accept structural edits, and a spec that took
  whatever came first would fail on a published one for a reason unrelated to what it tests.
*/
const EDITABLE = 'qasr-al-sharq-lodge';
import { findReference } from './partner-fixtures.js';

/**
 * A partner describes a room TYPE once and says how many there are (Bashar, 2026-09-06).
 *
 * ## What this is watching
 *
 * Not that a number field accepts a number. That the form CREATES that many rooms, that الوحدات
 * then shows them as one type rather than as N unexplained rows, and that a single room is left
 * alone — the three things that separate an authoring convenience from a screen that quietly
 * multiplies a partner's inventory.
 */
test.describe.configure({ mode: 'serial' });
test.use({ storageState: PARTNER_STATE, viewport: { width: 1280, height: 1100 } });

test('adding six identical rooms creates six, shown as one type', async ({ page }) => {
  const reference = await findReference(page, EDITABLE);

  await page.goto(`${PARTNER_BASE}/properties/${reference}/edit`, {
    waitUntil: 'domcontentloaded',
  });

  const before = await page.locator('[data-unit]').count();

  await page.locator(`[data-add-unit="${reference}"]`).first().click();

  const form = page.locator(`form[data-add-unit="${reference}"]`);
  const name = `نوع اختبار ${String(Date.now()).slice(-6)}`;

  await form.getByLabel('اسم الوحدة').fill(name);
  await form.getByLabel('السعر الأساسي لليلة').fill('88');

  /* The field this whole change exists for. */
  const quantity = form.getByLabel('عدد الغرف المتطابقة');

  await expect(quantity, 'the form asks how many').toBeVisible();
  await quantity.fill('6');

  const created = page.waitForResponse(
    (r) => r.url().includes('/units') && r.request().method() === 'POST',
  );

  await form.getByRole('button', { name: 'أضف الوحدة' }).click();
  expect((await created).status(), 'the rooms were created').toBeLessThan(300);

  /* The confirmation NAMES the number — six rows appearing is not the same as being told. */
  /*
    Western digits, deliberately: `plural()` formats through IntlMessageFormat and this platform
    writes Arabic with Latin numerals — see the note on the helper. Asserting «٦» would have been
    asserting a convention the product does not use.
  */
  await expect(form).toContainText('6 غرف');

  await page.goto(`${PARTNER_BASE}/properties/${reference}/edit`, {
    waitUntil: 'domcontentloaded',
  });

  const after = await page.locator('[data-unit]').count();

  expect(after - before, 'six rooms, not one').toBe(6);

  /*
    And they read as ONE type. Six identical rows with no heading is the state this replaces — the
    platform understood them as a group and the screen said nothing about it.
  */
  const group = page.locator('details[data-unit-type]').filter({ hasText: name });

  await expect(group, 'the type is named and counted').toContainText('6 غرف متطابقة');

  /*
    And it is FOLDED. One press now produces six full-height editors, so a type that opened them
    all would have made the screen worse in exchange for making the form better.
  */
  expect(await group.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);

  await group.locator('summary').click();
  expect(
    await group.evaluate((el) => (el as HTMLDetailsElement).open),
    'and it opens when the partner has business with the rooms',
  ).toBe(true);
  await expect(group.locator('[data-unit]')).toHaveCount(6);
});

test('a single room gets no type heading', async ({ page }) => {
  const reference = await findReference(page, EDITABLE);

  await page.goto(`${PARTNER_BASE}/properties/${reference}/edit`, {
    waitUntil: 'domcontentloaded',
  });

  const before = await page.locator('[data-unit]').count();

  await page.locator(`[data-add-unit="${reference}"]`).first().click();

  const form = page.locator(`form[data-add-unit="${reference}"]`);
  const name = `وحدة مفردة ${String(Date.now()).slice(-6)}`;

  await form.getByLabel('اسم الوحدة').fill(name);
  await form.getByLabel('السعر الأساسي لليلة').fill('120');
  await form.getByLabel('عدد الغرف المتطابقة').fill('1');

  const created = page.waitForResponse(
    (r) => r.url().includes('/units') && r.request().method() === 'POST',
  );

  await form.getByRole('button', { name: 'أضف الوحدة' }).click();
  expect((await created).status()).toBeLessThan(300);

  await page.goto(`${PARTNER_BASE}/properties/${reference}/edit`, {
    waitUntil: 'domcontentloaded',
  });

  /*
    The opposite control. Without it "group everything" would pass the test above, and every villa
    on the platform would carry a heading announcing it is one identical room.
  */
  await expect(
    page.locator('details[data-unit-type]').filter({ hasText: name }),
    'a lone room is not a type',
  ).toHaveCount(0);

  /*
    But it IS there — otherwise "no group" would pass against a room that never got created.

    Counted rather than found by name: a unit row carries its name in an INPUT, and `hasText` reads
    text content, so searching for the name matched nothing and the control silently proved the
    wrong thing.
  */
  expect(await page.locator('[data-unit]').count(), 'one room was added').toBe(
    before + 1,
  );
});

test('a field a partner types into is not forced left-to-right', async ({ page }) => {
  const reference = await findReference(page, EDITABLE);

  await page.goto(`${PARTNER_BASE}/properties/${reference}/edit`, {
    waitUntil: 'domcontentloaded',
  });

  await page.locator(`[data-add-unit="${reference}"]`).first().click();

  const form = page.locator(`form[data-add-unit="${reference}"]`);

  /*
    The standing rule: a field somebody types into follows the PAGE's direction. `dir="ltr"` sets
    the direction and moves the element's start edge, so the label sat on the right of its own
    field and the value on the far left of it. Read from the browser, not from the class list.
  */
  for (const label of ['عدد الضيوف', 'السعر الأساسي لليلة', 'عدد الغرف المتطابقة']) {
    const direction = await form
      .getByLabel(label)
      .evaluate((el) => getComputedStyle(el).direction);

    expect(direction, `${label} follows the page`).toBe('rtl');
  }
});
