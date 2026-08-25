import { expect, test, type Page } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.use({ storageState: STAFF_STATE, viewport: { width: 1440, height: 1100 } });

const copy = t.sections.bookingDetail;

/**
 * §9.4's write surface, driven — notes, the two status actions, and the cross-links.
 *
 * ## Why this file exists at all
 *
 * All of it was «built and connected to nothing» until 2026-08-25. `POST /bookings/:ref/cancel`
 * carried the comment "Staff cancellation (§9.4)" and had no caller; `capture-payment` was
 * staff-gated with no caller; `booking.add_internal_note` had a COLUMN, a role-form checkbox and
 * an Arabic label, and no route at all. The console had no `app/api/bookings` directory. Every one
 * of those would have passed `pnpm verify` forever, which is exactly why the coverage that matters
 * here is a browser pressing the buttons.
 *
 * ## What it costs, knowingly
 *
 * The lifecycle test CONSUMES one `pending_payment` booking per run: capture is not reversible and
 * cancellation is terminal. `db:testbed` seeds them, so the pool is replenished by the ordinary
 * reseed — and the test SKIPS rather than fails when there is none left to spend, because a suite
 * that goes red for want of a fixture teaches everyone to ignore it. Same trade
 * `enforcement.spec.ts` documents for the violation it raises.
 */
const NOTE_ONE = 'اتصل العميل وطلب تأكيد موعد الوصول بعد العاشرة مساءً.';
const NOTE_TWO = 'الشريك وافق على الوصول المتأخر، ولا حاجة لإجراء إضافي.';
const CANCEL_REASON = 'أُلغي بطلب العميل بعد تعذّر السفر، وأُبلغ الشريك.';

/**
 * Two notes, and the assertion is that the FIRST one is still there.
 *
 * `bookings.internal_notes` was a single text column, so the obvious implementation would have had
 * the second note overwrite the first — the defect `partner_application_contacts` was created to
 * fix on a different screen («a second telephone call erased the first one's note», 2026-08-20).
 * Asserting that a note can be added proves nothing about that; asserting that adding a second one
 * leaves the first alone is the whole feature.
 */
test('a second internal note does not erase the first', async ({ page }) => {
  const reference = await anyBooking(page);

  await page.goto(`/bookings/${reference}`);
  await expect(page.getByRole('heading', { name: copy.notes })).toBeVisible();

  /* Said before anybody types: this is the fact that decides what belongs in the box. */
  await expect(page.getByText(copy.notesHint)).toBeVisible();

  const before = await page.locator('[data-note]').count();

  await addNote(page, NOTE_ONE);
  await addNote(page, NOTE_TWO);

  await page.reload();

  const notes = page.locator('[data-note]');

  await expect(notes).toHaveCount(before + 2);

  const text = await notes.allInnerTexts();

  /* Both survive, and OLDEST first — the section is a history and reads downwards. */
  const first = text.findIndex((entry) => entry.includes(NOTE_ONE));
  const second = text.findIndex((entry) => entry.includes(NOTE_TWO));

  expect(first, 'the first note is still on the record').toBeGreaterThanOrEqual(0);
  expect(second, 'and so is the second').toBeGreaterThanOrEqual(0);
  expect(first, 'oldest first').toBeLessThan(second);

  /* A note nobody can attribute is a note nobody can act on. */
  await expect(notes.nth(second)).not.toHaveText(/^\s*$/);
  expect(
    (await notes.nth(second).innerText()).replace(NOTE_TWO, '').trim().length,
    'the note carries an author and a time beneath it',
  ).toBeGreaterThan(0);
});

/**
 * The whole staff lifecycle in one pass: capture, then cancel.
 *
 * ## Why both in one test
 *
 * Capturing is what MAKES the booking cancellable — staff are not an actor on
 * `pending_payment → cancelled`, so the cancel control cannot legitimately exist before the
 * capture. Splitting them would mean the cancel half hunting for a booking in the right state and
 * finding whatever the fixture happened to leave, which is how `enforcement.spec.ts` ended up
 * passing three runs in four against a defect.
 *
 * ## The control appearing and DISAPPEARING are both assertions
 *
 * A screen that offered both buttons in every state would pass any test that only ever checks the
 * one it is about to press.
 */
test('capturing payment opens the cancellation, and cancelling closes the booking', async ({
  page,
}) => {
  await page.goto('/bookings?status=pending_payment&size=10');

  const row = page.locator('a[href^="/bookings/BKG-"]').first();

  test.skip(
    (await row.count()) === 0,
    'No booking is awaiting payment — reseed with `pnpm db:testbed` to replenish the pool.',
  );

  const reference = (await row.innerText()).trim();

  await page.goto(`/bookings/${reference}`);

  /* Before: capture is offered and cancellation is NOT — staff cannot cancel an unpaid booking. */
  await expect(page.getByRole('button', { name: copy.capturePayment })).toBeVisible();
  await expect(page.getByRole('button', { name: copy.cancelBooking })).toHaveCount(0);
  /* The clock this starts, stated before it is started. */
  await expect(page.getByText(copy.captureHint)).toBeVisible();

  await page.getByRole('button', { name: copy.capturePayment }).click();
  await expect(page.getByText(copy.paymentCaptured)).toBeVisible({ timeout: 20_000 });

  /*
    The status moved on the SCREEN, not merely in a message.

    A confirmation that appears while the pill still reads «بانتظار الدفع» is the shape this
    codebase keeps meeting — a true sentence describing an intention rather than a change.
  */
  await expect(page.locator('[data-status-pill]').first()).toHaveText(
    t.bookingStatus['pending_confirmation'] ?? '',
  );

  await page.reload();

  /* And now the pair has swapped: capture is spent, cancellation is available. */
  await expect(page.getByRole('button', { name: copy.capturePayment })).toHaveCount(0);
  await expect(page.getByRole('button', { name: copy.cancelBooking })).toBeVisible();

  /* ── Cancel ─────────────────────────────────────────────────────────── */
  await page.getByRole('button', { name: copy.cancelBooking }).first().click();

  /* The consequence is on screen before the field, as on «تعليق الحساب». */
  await expect(page.getByText(copy.cancelHint)).toBeVisible();

  await page.getByLabel(copy.cancelReasonLabel).fill(CANCEL_REASON);
  await page.getByRole('button', { name: copy.cancelBooking }).last().click();
  await expect(page.getByText(copy.bookingCancelled)).toBeVisible({ timeout: 20_000 });

  await page.reload();

  await expect(page.locator('[data-status-pill]').first()).toHaveText(
    t.bookingStatus['cancelled'] ?? '',
  );

  /*
    The reason reaches the RECORD, not just the request — and it is asserted on the الإلغاء
    section rather than anywhere on the page.

    A bare `getByText` matched TWO elements: this section and the timeline's `booking.cancelled`
    payload. Both are correct and they prove different things — the timeline says the event carried
    a reason, this says the BOOKING did. The record is the one a support agent reads first, and
    scoping the assertion is what keeps it about that rather than about whichever element happened
    to render.
  */
  await expect(
    page.locator('section').filter({ hasText: copy.cancellation }).last(),
  ).toContainText(CANCEL_REASON);

  /* Nothing is left to offer on a cancelled booking, and the screen says so by offering nothing. */
  await expect(page.getByRole('button', { name: copy.cancelBooking })).toHaveCount(0);
  await expect(page.getByRole('button', { name: copy.capturePayment })).toHaveCount(0);
});

/**
 * The cross-links, and the number on them.
 *
 * A link is only worth following if it leads somewhere, so each card carries a count. The
 * assertion is that the count MATCHES what the destination actually lists — «٧ نزاعات» above a
 * screen showing three is worse than no number at all, and it is the failure a count computed on
 * one side and a filter written on the other produces silently.
 */
test('a booking links to its disputes, and the count is the number that are there', async ({
  page,
}) => {
  await page.goto('/disputes?size=25');

  const link = page.locator('a[href^="/bookings/BKG-"]').first();

  test.skip((await link.count()) === 0, 'No dispute to follow back to a booking.');

  const reference = (await link.innerText()).trim();

  await page.goto(`/bookings/${reference}`);
  await expect(page.getByRole('heading', { name: copy.elsewhere })).toBeVisible();

  const card = page.locator(`a[href="/disputes?q=${reference}"]`);

  await expect(card, 'the link carries this booking as the filter').toBeVisible();

  const claimed = Number(
    /\d+/.exec(
      (await card.innerText()).replace(/[٠-٩]/g, (digit) =>
        String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)),
      ),
    )?.[0] ?? '1',
  );

  await card.click();
  await page.waitForURL(/\/disputes\?/);

  const listed = new Set(
    (await page.locator('main').innerText()).match(/DSP-\d+/g) ?? [],
  );

  expect(listed.size, 'the card counted what the screen lists').toBe(claimed);

  /* And every one of them is THIS booking's — a filter that matched everything would also pass. */
  const body = await page.locator('main').innerText();

  expect(
    (body.match(new RegExp(reference, 'g')) ?? []).length,
    'every dispute listed belongs to this booking',
  ).toBeGreaterThanOrEqual(listed.size);
});

/** The newest booking in the registry — any one will do for a note. */
async function anyBooking(page: Page): Promise<string> {
  await page.goto('/bookings?size=10');

  const row = page.locator('a[href^="/bookings/BKG-"]').first();

  expect(await row.count(), 'the registry has a booking to open').toBeGreaterThan(0);

  return (await row.innerText()).trim();
}

/** Fills the box and waits for the confirmation, so the next note cannot race the first. */
async function addNote(page: Page, note: string): Promise<void> {
  await page.locator('textarea[name="note"]').fill(note);
  await page.getByRole('button', { name: copy.addNote }).click();
  await expect(page.getByText(copy.noteAdded)).toBeVisible({ timeout: 20_000 });
}
