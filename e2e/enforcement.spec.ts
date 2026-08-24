import { expect, test } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.use({ storageState: STAFF_STATE, viewport: { width: 1440, height: 1100 } });

const copy = t.sections.enforcement;
const REASON = 'مخالفة متكررة في تحديث التقويم بعد إشعارين سابقين';

/**
 * The whole enforcement progression, in a browser: suspend, raise, fine, waive, lift.
 *
 * ## Why this drives the money display in particular
 *
 * Bashar's rule (2026-08-24) is that enforcement is never solved by deleting history: a waived fine
 * keeps BOTH entries and nets to zero. That rule is invisible to every other kind of test — a
 * service test sees two ledger rows and is satisfied, and the screen could still render «—» or the
 * net alone and pass everything. The three assertions at the end are the rule made checkable.
 *
 * ## It leaves the fixture partner trading
 *
 * Suspension is real: it hides listings, refuses bookings and freezes payouts. A run that ended with
 * a suspended partner would leak into every later spec that expects one to behave normally, so the
 * lift at the end is asserted by ABSENCE of the banner rather than by a success message.
 *
 * It raises a violation only when the partner has none, so re-running does not accumulate them.
 */
test('suspend, raise, fine, waive — and the waived fine shows both entries', async ({
  page,
}) => {
  const dir = process.env['SHOT_DIR'] as string;

  await page.goto('/partners?size=25');

  const row = page.locator('a[href^="/partners/PAR-"]').first();

  test.skip((await row.count()) === 0, 'No partner to enforce against.');

  const href = (await row.getAttribute('href')) ?? '';
  const reference = /PAR-\d+/.exec(href)?.[0] ?? '';

  await page.goto(`/partners/${reference}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  /* ── Suspend ────────────────────────────────────────────────────────── */
  const already = await page.locator('[data-partner-suspended]').count();

  if (already === 0) {
    await page.getByLabel(copy.suspendReasonLabel).fill(REASON);
    await page.getByLabel(copy.notesLabel).fill('ملاحظة داخلية للاختبار فقط');
    await page.getByRole('button', { name: copy.suspend }).click();
    await expect(page.getByText(copy.suspended)).toBeVisible({ timeout: 20_000 });
  }

  await page.reload();
  await expect(page.locator('[data-partner-suspended]')).toBeVisible();
  await expect(page.getByText(copy.suspendedTitle)).toBeVisible();
  /* The four clauses, not a pill. */
  await expect(page.getByText(copy.suspendedEffect)).toBeVisible();
  await expect(page.getByText(copy.suspendedNotesHint)).toBeVisible();
  await page.screenshot({ path: `${dir}/enf-1-suspended.png`, fullPage: false });

  /* ── Raise a violation, fine it, waive it ───────────────────────────── */
  await page.goto(`/partners/${reference}/violations`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  console.log('violations screen reached');

  /*
    Everything below is scoped to ONE row.

    `getByRole('button', { name: copy.fine }).last()` was my first attempt and it is wrong in a way
    that looks right: with two violations on screen the last «فرض غرامة» is the SECOND row's toggle,
    not the open form's submit. The click landed, nothing posted, and the test waited twenty seconds
    for a message that was never coming.
  */
  const rows = page.locator('main ul > li');

  if ((await rows.count()) === 0) {
    await page.getByRole('button', { name: copy.raise }).first().click();
    await page.getByLabel(copy.kindLabel).selectOption('stale_calendar');
    await page.getByLabel(copy.violationReasonLabel).fill(REASON);
    await page.getByRole('button', { name: copy.raise }).last().click();
    await expect(page.getByText(copy.raised)).toBeVisible({ timeout: 20_000 });
    await page.reload();
  }

  const target = rows.first();

  console.log(
    'fine offered :',
    await target.getByRole('button', { name: copy.fine }).count(),
  );
  console.log(
    'waive offered:',
    await target.getByRole('button', { name: copy.waive }).count(),
  );

  if ((await target.getByRole('button', { name: copy.fine }).count()) > 0) {
    await target.getByRole('button', { name: copy.fine }).first().click();
    await target.locator('input[name="amount"]').fill('50');
    await target.locator('input[name="currencyCode"]').fill('USD');
    await target.getByLabel(copy.violationReasonLabel).fill(REASON);
    await target.getByRole('button', { name: copy.fine }).last().click();
    await expect(page.getByText(copy.fined)).toBeVisible({ timeout: 20_000 });
    await page.reload();
  }

  const waiveRow = rows.first();

  if ((await waiveRow.getByRole('button', { name: copy.waive }).count()) > 0) {
    await waiveRow.getByRole('button', { name: copy.waive }).first().click();
    await waiveRow
      .getByLabel(copy.waiveReasonLabel)
      .fill('أُلغيت بعد مراجعة الحالة مع الشريك');
    await waiveRow.getByRole('button', { name: copy.waive }).last().click();
    await expect(page.getByText(copy.waived)).toBeVisible({ timeout: 20_000 });
    await page.reload();
  }

  const body = await page.locator('main').innerText();

  /*
    The three lines, asserted rather than logged.

    A waived fine must show the ORIGINAL, the balancing entry and the net — «—» or the net alone
    would be the deletion the ledger refuses, performed one layer higher where it is easier to do
    and harder to notice.
  */
  expect(body).toContain(copy.fineOriginal);
  expect(body).toContain(copy.fineWaiver);
  expect(body).toContain(copy.waivedNet);
  /* And the reason travels with the mark — «أُلغيت» with no reason is worse than no mark. */
  expect(body).toContain('أُلغيت بعد مراجعة الحالة مع الشريك');

  await page.screenshot({ path: `${dir}/enf-2-violations.png`, fullPage: true });

  /* ── Lift it, so the fixture partner is left trading ─────────────────── */
  await page.goto(`/partners/${reference}`);
  await page
    .getByLabel(copy.unsuspendReasonLabel)
    .fill('رُفع الإيقاف بعد معالجة السبب بالكامل');
  await page.getByRole('button', { name: copy.unsuspend }).click();
  await expect(page.getByText(copy.unsuspended)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.locator('[data-partner-suspended]')).toHaveCount(0);
  console.log('lifted, partner trading again');
});
