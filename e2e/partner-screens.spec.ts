import { expect, test, type Page } from '@playwright/test';

import { partnerAr as t } from '../packages/i18n/src/partner.js';
import { findReference } from './partner-fixtures.js';
import { PARTNER_BASE as BASE, PARTNER_STATE } from './partner-session.js';

/**
 * تعديل العقار and تقويم الإتاحة — the two screens that used to be greyed-out labels.
 *
 * ## What is worth proving in a browser
 *
 * Both screens are governed by a rule the API owns and the UI must not restate. The edit form is
 * offered only where `isStructurallyEditable` says so; the calendar's status select offers only
 * what `partnerSettableStatusSchema` accepts. A UI that decided either for itself would drift, and
 * the drift is invisible to the API's own tests: they would keep passing while the screen offered
 * a form whose submit is refused, or a state the endpoint rejects.
 *
 * So what is asserted here is mostly AGREEMENT — that the screen offers exactly what the server
 * will accept — plus the round trip, because a form that appears to save and does not is the
 * failure mode that costs a partner their work.
 *
 * ## Fixtures
 *
 * `db:testbed` gives partner1 three published listings, one draft and one rejected. All three
 * states are needed: the draft exercises the form, the published one exercises the refusal, and
 * the rejected one carries the review notes that make reopening the form worthwhile.
 *
 * ## Idempotent
 *
 * `pnpm e2e` does not re-seed, so every write here is undone by the test that made it — the
 * address is put back and closed dates are reopened. A spec that left a listing renamed would
 * pass once and then describe a fixture nobody else expects.
 */

test.use({ storageState: PARTNER_STATE });

/**
 * The screen's own banner.
 *
 * Scoped to the `<p>`: Next renders a permanently-present empty `<div role="alert">` route
 * announcer, so the bare role matches two elements and every assertion against it is a strict-mode
 * violation rather than a result.
 */
function banner(page: Page) {
  return page.locator('p[role="alert"]');
}

const DRAFT = 'qasr-al-sharq-lodge';
const REJECTED = 'qasr-al-sharq-rest-house';
const PUBLISHED = 'qasr-al-sharq-apartments';
/** The one listing with two units, so the unit selector has something to select. */
const TWO_UNITS = 'qasr-al-sharq-malki';

test.describe('تعديل العقار', () => {
  test('the registry offers تعديل and التقويم as real links, not greyed-out labels', async ({
    page,
  }) => {
    await page.goto(`${BASE}/properties`);

    const edit = page.getByRole('link', { name: t.properties.edit }).first();
    const calendar = page.getByRole('link', { name: t.properties.calendar }).first();

    await expect(edit).toBeVisible();
    await expect(calendar).toBeVisible();

    /* The old version was a `<span aria-disabled>` — a link is the whole point of this change. */
    await expect(edit).toHaveAttribute('href', /\/properties\/PRO-\d+\/edit/);
    await expect(calendar).toHaveAttribute('href', /\/properties\/PRO-\d+\/calendar/);

    /* And nothing anywhere still claims the section was never built. */
    await expect(page.getByText('لم يُبنَ هذا القسم بعد')).toHaveCount(0);
  });

  test('a draft offers the form, and a change survives a reload', async ({ page }) => {
    const reference = await findReference(page, DRAFT);

    await page.goto(`${BASE}/properties/${reference}/edit`);

    const address = page.getByLabel(t.editProperty.address);

    await expect(address).toBeVisible();

    const original = await address.inputValue();
    const edited = `${original} — تعديل اختباري`;

    await address.fill(edited);
    await page.getByRole('button', { name: t.editProperty.save }).click();

    await expect(banner(page)).toContainText(t.editProperty.saved);

    /* Stored, not merely acknowledged. */
    await page.reload();
    await expect(page.getByLabel(t.editProperty.address)).toHaveValue(edited);

    /* Put it back, so the next run starts where this one did. */
    await page.getByLabel(t.editProperty.address).fill(original);
    await page.getByRole('button', { name: t.editProperty.save }).click();
    await expect(banner(page)).toContainText(t.editProperty.saved);

    await page.reload();
    await expect(page.getByLabel(t.editProperty.address)).toHaveValue(original);
  });

  test('a published listing explains the refusal instead of showing a form', async ({
    page,
  }) => {
    const reference = await findReference(page, PUBLISHED);

    await page.goto(`${BASE}/properties/${reference}/edit`);

    await expect(page.getByText(t.editProperty.lockedTitle)).toBeVisible();
    /* The REASON, not just the refusal — «لا يمكن» alone reads as a fault. */
    await expect(page.getByText(t.editProperty.lockedWhy)).toBeVisible();

    /* No form at all: not a disabled one, which would still invite the work. */
    await expect(page.getByLabel(t.editProperty.address)).toHaveCount(0);
    await expect(page.getByRole('button', { name: t.editProperty.save })).toHaveCount(0);

    /* And it names what IS still editable, so the screen is not a dead end. */
    await expect(
      page.getByRole('link', { name: t.editProperty.goCalendar }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: t.editProperty.goImages })).toBeVisible();
  });

  test('a rejected listing shows why, above a form that can fix it', async ({ page }) => {
    const reference = await findReference(page, REJECTED);

    await page.goto(`${BASE}/properties/${reference}/edit`);

    await expect(page.getByText(t.editProperty.rejectedTitle)).toBeVisible();
    await expect(page.getByText(/العنوان في الوثائق/)).toBeVisible();

    /* Reopened for editing, because that is the whole point of telling somebody what was wrong. */
    await expect(page.getByLabel(t.editProperty.address)).toBeVisible();
  });
});

test.describe('تقويم الإتاحة', () => {
  test('draws a month of real days for a unit', async ({ page }) => {
    const reference = await findReference(page, DRAFT);

    await page.goto(`${BASE}/properties/${reference}/calendar`);

    const days = page.locator('[data-day]');

    /* A month, not a placeholder: every square is derived, so a quiet month still has all of them. */
    await expect(days.first()).toBeVisible();
    expect(await days.count()).toBeGreaterThanOrEqual(28);
    expect(await days.count()).toBeLessThanOrEqual(31);
  });

  test('never offers «محجوز», because a partner may not declare a booking', async ({
    page,
  }) => {
    const reference = await findReference(page, DRAFT);

    await page.goto(`${BASE}/properties/${reference}/calendar`);

    const select = page.getByLabel(t.unitCalendar.status);
    const options = await select
      .locator('option')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));

    expect(options).toContain('available');
    expect(options).toContain('closed');
    expect(options).toContain('maintenance');
    /*
      The one that matters. `booked` is derived from real bookings; a partner able to write it
      could hold inventory back from سفرة while appearing available (§8.4).
    */
    expect(options).not.toContain('booked');
  });

  test('closing a span changes those days, and reopening puts them back', async ({
    page,
  }) => {
    const reference = await findReference(page, DRAFT);

    await page.goto(`${BASE}/properties/${reference}/calendar`);

    /* Two days that are actually available now — a fixed date could be booked by another test. */
    const available = await page
      .locator('[data-day][data-day-status="available"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-day') ?? ''));

    const from = available[0];
    const to = available[1] ?? available[0];

    expect(from).toBeTruthy();

    await page.getByLabel(t.unitCalendar.from).fill(from ?? '');
    await page.getByLabel(t.unitCalendar.to).fill(to ?? '');
    await page.getByLabel(t.unitCalendar.status).selectOption('closed');
    await page.getByRole('button', { name: t.unitCalendar.apply }).click();

    await expect(banner(page)).toContainText(t.unitCalendar.applied);
    await expect(page.locator(`[data-day="${from}"]`)).toHaveAttribute(
      'data-day-status',
      'closed',
    );

    /* Written, not just re-rendered. */
    await page.reload();
    await expect(page.locator(`[data-day="${from}"]`)).toHaveAttribute(
      'data-day-status',
      'closed',
    );

    /* Reopen, so the next run finds the month it expects. */
    await page.getByLabel(t.unitCalendar.from).fill(from ?? '');
    await page.getByLabel(t.unitCalendar.to).fill(to ?? '');
    await page.getByLabel(t.unitCalendar.status).selectOption('available');
    await page.getByRole('button', { name: t.unitCalendar.apply }).click();

    await expect(banner(page)).toContainText(t.unitCalendar.applied);
    await page.reload();
    await expect(page.locator(`[data-day="${from}"]`)).toHaveAttribute(
      'data-day-status',
      'available',
    );
  });

  test('a nightly price override applies to the span and is marked as an override', async ({
    page,
  }) => {
    const reference = await findReference(page, DRAFT);

    await page.goto(`${BASE}/properties/${reference}/calendar`);

    const available = await page
      .locator('[data-day][data-day-status="available"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-day') ?? ''));

    const day = available[0] ?? '';

    await page.getByLabel(t.unitCalendar.from).fill(day);
    await page.getByLabel(t.unitCalendar.to).fill(day);
    await page.getByLabel(t.unitCalendar.price).fill('123');
    await page.getByRole('button', { name: t.unitCalendar.apply }).click();

    await expect(banner(page)).toContainText(t.unitCalendar.applied);
    await page.reload();
    await expect(page.locator(`[data-day="${day}"]`)).toContainText('123');

    /* Clear it back to the unit's base price — the `null` the contract distinguishes from absent. */
    await page.getByLabel(t.unitCalendar.from).fill(day);
    await page.getByLabel(t.unitCalendar.to).fill(day);
    await page.getByRole('button', { name: t.unitCalendar.priceClear }).click();
    await page.getByRole('button', { name: t.unitCalendar.apply }).click();

    await expect(banner(page)).toContainText(t.unitCalendar.applied);
    await page.reload();
    await expect(page.locator(`[data-day="${day}"]`)).not.toContainText('123');
  });

  test('the unit and the month live in the URL, so the view is shareable', async ({
    page,
  }) => {
    const reference = await findReference(page, TWO_UNITS);

    await page.goto(`${BASE}/properties/${reference}/calendar`);

    /* Two units means a selector; choosing one puts it in the address bar. */
    const second = page.locator('nav a[href*="unit="]').nth(1);

    await expect(second).toBeVisible();
    await second.click();
    await expect(page).toHaveURL(/unit=/);

    const before = page.url();

    await page.getByLabel(t.unitCalendar.nextMonth).click();

    /*
      Waiting for the URL to actually DIFFER, not merely to match a month pattern. The address
      before the click already matched, so a pattern assertion passes instantly against the old
      page and proves nothing about the navigation.
    */
    await page.waitForURL((url) => url.toString() !== before);

    expect(page.url()).toMatch(/month=\d{4}-\d{2}/);

    /* The unit survives the month change — losing it would silently switch which unit is edited. */
    expect(page.url()).toContain('unit=');
  });

  test('an unknown unit falls back rather than erroring', async ({ page }) => {
    const reference = await findReference(page, DRAFT);

    /*
      A crafted id must not render another partner's calendar and must not produce an error page.
      The screen picks the property's own first unit instead — the API would refuse the id anyway,
      and this makes the refusal invisible rather than alarming.
    */
    await page.goto(
      `${BASE}/properties/${reference}/calendar?unit=00000000-0000-4000-8000-000000000000`,
    );

    await expect(page.locator('[data-day]').first()).toBeVisible();
  });
});
