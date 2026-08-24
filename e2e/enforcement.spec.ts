import { expect, test } from '@playwright/test';

import { FINE_CURRENCIES } from '../packages/contracts/src/enforcement.js';
import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.use({ storageState: STAFF_STATE, viewport: { width: 1440, height: 1100 } });

const copy = t.sections.enforcement;

/**
 * Every partner this file suspends, so the suspension cannot outlive the run.
 *
 * ## Why an `afterAll` and not only the inline lift
 *
 * Both tests here lift what they imposed as their last step, which is correct and was not enough. On
 * 2026-08-24 a run failed midway — the console's violation list stopped parsing because a field was
 * added to a query and not to its response mapping — and the test aborted BEFORE its lift, leaving
 * `PAR-236708` suspended for forty-five minutes across later runs. A suspended partner leaks into
 * every spec that expects one to trade, and the failure it produces names something else entirely.
 *
 * `partner-suspension.spec.ts` already had this. The standing requirement is that no partner remains
 * suspended after the suite, and an inline lift only holds on the happy path.
 */
const suspendedHere = new Set<string>();
const REASON = 'مخالفة متكررة في تحديث التقويم بعد إشعارين سابقين';
/** The warning text, which the partner reads on their own مخالفات screen. */
const WARNING = 'يرجى تحديث تقويم الإتاحة خلال ٢٤ ساعة وإغلاق التواريخ غير المتاحة.';
/** The reason every lift in this file gives, including the safety net's. */
const LIFT = 'رُفع الإيقاف بعد معالجة السبب بالكامل';

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
/*
  Unconditional, and it runs even when a test above fails partway.

  Reads the banner first: posting an unsuspend to a partner who is not suspended is a 400, and a
  cleanup that fails is worse than one that finds nothing to do.
*/
test.afterAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: STAFF_STATE });
  const page = await context.newPage();

  /*
    Also heals a suspension a PREVIOUS run leaked — and finds them from the LIST, not by opening
    every record.

    `PAR-236708` sat suspended for forty-five minutes on 2026-08-24 because the run that imposed it
    aborted before its lift, and the set below only knows about the current run. الشركاء already
    marks a suspended partner with a «موقوف مؤقتاً» pill (suspension outranks verification on that
    screen), so the candidates come from one page load rather than a hundred; only those are opened,
    and only to confirm the REASON.

    Matching the reason is the safeguard. A blanket "lift everything suspended" would be far worse
    than the leak: the console is a real tool and an operator's deliberate suspension is not this
    suite's to undo. Only rows this file wrote carry that exact sentence.
  */
  await page.goto('/partners?size=100');

  const rows = page.locator('a[href^="/partners/PAR-"]');
  const candidates: string[] = [];

  for (const row of await rows.all()) {
    const href = (await row.getAttribute('href')) ?? '';
    const found = /PAR-\d+/.exec(href)?.[0];

    if (!found) continue;

    /* The pill lives on the row, so the list alone says who is worth opening. */
    const marked = await page
      .locator('tr, li')
      .filter({ hasText: found })
      .filter({ hasText: t.sections.partners.suspended })
      .count();

    if (marked > 0) candidates.push(found);
  }

  for (const candidate of candidates) {
    await page.goto(`/partners/${candidate}`);

    if ((await page.getByText(REASON).count()) > 0) suspendedHere.add(candidate);
  }

  for (const reference of suspendedHere) {
    await page.goto(`/partners/${reference}`);

    if ((await page.locator('[data-partner-suspended]').count()) === 0) continue;

    await page.getByLabel(copy.unsuspendReasonLabel).fill(LIFT);
    await page.getByRole('button', { name: copy.unsuspend }).click();
    await expect(page.getByText(copy.unsuspended)).toBeVisible({ timeout: 20_000 });
    console.log(`afterAll lifted the suspension on ${reference}`);
  }

  await context.close();
});

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

  suspendedHere.add(reference);

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
    /*
      The currency is a MENU of exactly three, and the amount says what it wants (Bashar, 2026-08-24).

      Asserted on the OPTION VALUES rather than the labels: the values are what the API receives,
      while the labels carry a symbol somebody could reword.

      The three codes are written OUT here rather than read from `FINE_CURRENCIES`, and that is the
      whole point. The options are RENDERED from that constant, so comparing the DOM against it is a
      tautology — add a fourth currency and both sides move together and the test still passes,
      while the rule it was supposed to protect is gone. Restating the rule independently of the
      code that implements it means widening the list has to be a decision somebody makes here too.
    */
    const currency = target.locator('select[name="currencyCode"]');

    expect(
      await currency
        .locator('option')
        .evaluateAll((o) => o.map((n) => (n as HTMLOptionElement).value)),
    ).toStrictEqual(['USD', 'EUR', 'SYP']);

    /* And the constant the form reads really is that list, so the two cannot drift silently. */
    expect([...FINE_CURRENCIES]).toStrictEqual(['USD', 'EUR', 'SYP']);

    /* The placeholder is on screen, not merely in the catalogue. */
    await expect(target.locator('input[name="amount"]')).toHaveAttribute(
      'placeholder',
      copy.fineAmountPlaceholder,
    );

    await target.locator('input[name="amount"]').fill('50');
    /*
      A SELECT since 2026-08-24, not a text box — `selectOption`, not `fill`.

      `fill` on a select throws rather than silently missing, which is the right failure: the three
      currencies SAFRA fines in come from `FINE_CURRENCIES`, and a spec that typed a code would keep
      passing if the menu ever stopped offering it.
    */
    await target.locator('select[name="currencyCode"]').selectOption('USD');
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

/**
 * The ladder's fourth rung, driven: suspending a partner BECAUSE of a named violation.
 *
 * ## Why this is a separate test and runs after the first
 *
 * The escalation control is hidden while the partner is already suspended — the API answers a
 * second suspension with `PARTNER_ALREADY_SUSPENDED`, and a button whose only outcome is a conflict
 * is worse than no button. So this needs the partner TRADING when it starts, which is exactly the
 * state the test above is careful to leave behind.
 *
 * ## What it proves that the integration test cannot
 *
 * `violation-escalation.integration.test.ts` proves the service writes the stage and scopes it to
 * the partner. It says nothing about whether a human can reach it. Before this, `stage =
 * 'suspension'` had an Arabic label («رُفع إلى الإيقاف») and a place in three schemas for a state no
 * screen could produce — the defect being fixed is precisely "built and connected to nothing", so a
 * test that never presses the button would miss the whole point.
 *
 * ## It accumulates one violation per run, deliberately
 *
 * `suspension` is terminal and forward-only, so a violation escalated on one run cannot be
 * escalated again on the next. Reusing the row would mean asserting an end state rather than
 * driving a transition — a control that changes nothing proving nothing. One extra row per run on
 * one fixture partner is the price of actually pressing it, and it is paid knowingly.
 */
test('escalating a violation suspends the partner and records it as the cause', async ({
  page,
}) => {
  const dir = process.env['SHOT_DIR'] as string;

  await page.goto('/partners?size=25');

  const row = page.locator('a[href^="/partners/PAR-"]').first();

  test.skip((await row.count()) === 0, 'No partner to enforce against.');

  const href = (await row.getAttribute('href')) ?? '';
  const reference = /PAR-\d+/.exec(href)?.[0] ?? '';

  /* The previous test lifts what it imposed; if it did not, this cannot run at all. */
  await page.goto(`/partners/${reference}`);
  await expect(page.locator('[data-partner-suspended]')).toHaveCount(0);

  await page.goto(`/partners/${reference}/violations`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  /*
    A violation of its own, raised here rather than reused — see the note above.

    `.first()` on the toggle and `.last()` on the submit: with the form open there are two controls
    reading «تسجيل مخالفة», and taking the wrong one clicks a toggle, posts nothing, and waits
    twenty seconds for a message that is never coming. The same trap the fine flow documents.
  */
  await page.getByRole('button', { name: copy.raise }).first().click();
  await page.getByLabel(copy.kindLabel).selectOption('stale_calendar');
  await page.getByLabel(copy.violationReasonLabel).fill(REASON);
  await page.getByRole('button', { name: copy.raise }).last().click();
  await expect(page.getByText(copy.raised)).toBeVisible({ timeout: 20_000 });
  await page.reload();

  /* The newest violation is first — the list is ordered by `created_at` descending. */
  const target = page.locator('main ul > li').first();

  /*
    ── The WARNING, the one rung no spec had ever clicked ──────────────────

    `enforcement.spec.ts` raised, fined and waived; `canWarn` needs `warnedAt === null`, which a
    fresh violation satisfies, so nothing was stopping it — it was simply never driven. That matters
    more since 2026-08-24, because warning is now one of the five events that NOTIFIES the partner,
    and «صدر الإنذار وأُبلغ الشريك» is a claim the console makes on screen.

    Warned BEFORE the fine, which is the order the ladder runs in and the order an operator uses.
  */
  await expect(target.getByRole('button', { name: copy.warn })).toBeVisible();
  await target.getByRole('button', { name: copy.warn }).first().click();
  await target.getByLabel(copy.warnNoteLabel).fill(WARNING);
  await target.getByRole('button', { name: copy.warn }).last().click();
  await expect(page.getByText(copy.warned)).toBeVisible({ timeout: 20_000 });
  await page.reload();

  /* The note reaches the row — it is written FOR the partner and both screens render it. */
  await expect(page.locator('main ul > li').first()).toContainText(WARNING);

  await expect(target.getByRole('button', { name: copy.escalate })).toBeVisible();
  await target.getByRole('button', { name: copy.escalate }).first().click();

  /* The consequence is stated before the field, because this is the one control here that stops trade. */
  await expect(page.getByText(copy.escalateHint)).toBeVisible();

  await target.getByLabel(copy.escalateReasonLabel).fill(REASON);
  await target.getByRole('button', { name: copy.escalate }).last().click();
  await expect(page.getByText(copy.escalated)).toBeVisible({ timeout: 20_000 });

  suspendedHere.add(reference);

  await page.reload();

  /*
    Both halves, and neither implies the other.

    The stage label is the violation saying it caused a suspension; the banner is the partner being
    suspended. A change that wrote the stage and forgot to suspend would satisfy one of these, and
    that is the more likely half to break — it is the one with no visible consequence.
  */
  const escalated = page.locator('main ul > li').first();

  await expect(escalated).toContainText(t.enums.violationStage['suspension'] ?? '');
  /*
    And the DESCRIPTION is on the row, not only in the audit log.

    It was required by the form, labelled «يقرأه الشريك», and stored nowhere — so the console and
    the portal both showed a kind and a stage and no words. Asserted here because this test is the
    one that raises a violation through the form, so it is the one that can see what the form's own
    field became.
  */
  await expect(escalated).toContainText(REASON);
  await page.screenshot({ path: `${dir}/enf-3-escalated.png`, fullPage: true });

  await page.goto(`/partners/${reference}`);
  await expect(page.locator('[data-partner-suspended]')).toBeVisible();
  await expect(page.getByText(copy.suspendedTitle)).toBeVisible();

  /* And the control is gone now that it would only conflict. */
  await page.goto(`/partners/${reference}/violations`);
  await expect(
    page.locator('main ul > li').first().getByRole('button', { name: copy.escalate }),
  ).toHaveCount(0);

  /* ── Lift it, so the fixture partner is left trading ─────────────────── */
  await page.goto(`/partners/${reference}`);
  await page
    .getByLabel(copy.unsuspendReasonLabel)
    .fill('رُفع الإيقاف بعد معالجة السبب بالكامل');
  await page.getByRole('button', { name: copy.unsuspend }).click();
  await expect(page.getByText(copy.unsuspended)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.locator('[data-partner-suspended]')).toHaveCount(0);
});
