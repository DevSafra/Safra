import { expect, test, type Page } from '@playwright/test';

import { COMPENSATION_CURRENCIES } from '../packages/contracts/src/booking.js';
import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.use({ storageState: STAFF_STATE, viewport: { width: 1440, height: 1100 } });

const copy = t.sections.bookingDetail;

/**
 * «لا نزاعات» — the ZERO branch of the related-disputes plural, taken from the catalogue.
 *
 * Read out of the ICU string rather than written here, so the day somebody rewords it this stops
 * matching loudly instead of silently selecting a booking that already has a dispute.
 */
const NO_DISPUTES = /zero \{([^}]*)\}/.exec(copy.relatedDisputes)?.[1]?.trim() ?? '';

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
const CONFIRM_REASON =
  'اتصل الشريك هاتفياً وأكّد توفر الوحدة، وتعذّر عليه الدخول إلى لوحته.';

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
 * The whole staff lifecycle, driven in one pass (SRS §6.2, §6.3).
 *
 * ## Why one test and not five
 *
 * Each move is what MAKES the next one available — §6.2's table is a sequence, and the controls
 * follow it. Splitting them would mean each half hunting for a booking in the right state and
 * finding whatever the fixture happened to leave, which is how the first test in this file passed
 * three runs in four against a real defect.
 *
 * ## The control appearing and DISAPPEARING are both assertions
 *
 * A screen that offered every button in every state would pass any test that only ever checks the
 * one it is about to press. So each step asserts the pair: what is now offered, and what is gone.
 *
 * ## What it costs, knowingly
 *
 * It consumes one `pending_confirmation` booking per run and leaves it `completed`. There are ~950
 * of them and `db:testbed` seeds more; the test SKIPS rather than fails if the pool ever empties,
 * because a suite that goes red for want of a fixture teaches everyone to ignore it.
 */
test('a booking walks its whole lifecycle, and each control appears only in its own state', async ({
  page,
}) => {
  await page.goto('/bookings?status=pending_confirmation&size=5');

  const row = page.locator('a[href^="/bookings/BKG-"]').first();

  test.skip(
    (await row.count()) === 0,
    'No booking awaits confirmation — reseed with `pnpm db:testbed`.',
  );

  const reference = (await row.innerText()).trim();
  const pill = page.locator('[data-status-pill]').first();
  const button = (name: string) => page.getByRole('button', { name, exact: true });

  await page.goto(`/bookings/${reference}`);

  /* ── Awaiting the partner: SAFRA may answer for them, or cancel. Nothing else. ── */
  await expect(button(copy.confirmBooking)).toBeVisible();
  await expect(button(copy.cancelBooking)).toBeVisible();
  await expect(
    button(copy.checkIn),
    'nobody arrives at an unconfirmed booking',
  ).toHaveCount(0);
  await expect(button(copy.completeStay)).toHaveCount(0);

  await button(copy.confirmBooking).click();
  await expect(page.getByText(copy.confirmHint)).toBeVisible();
  await page.getByLabel(copy.confirmReasonLabel).fill(CONFIRM_REASON);
  await button(copy.confirmBooking).last().click();
  await expect(page.getByText(copy.bookingConfirmed)).toBeVisible({ timeout: 20_000 });
  await expect(pill).toHaveText(t.bookingStatus['confirmed'] ?? '');

  /* ── Confirmed: the guest may now arrive, and SAFRA may not answer twice. ── */
  await page.reload();
  await expect(button(copy.checkIn)).toBeVisible();
  await expect(button(copy.confirmBooking), 'it is already confirmed').toHaveCount(0);
  await expect(button(copy.completeStay), 'nobody has arrived yet').toHaveCount(0);

  await button(copy.checkIn).click();
  await expect(page.getByText(copy.checkedIn)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(pill).toHaveText(t.bookingStatus['checked_in'] ?? '');

  /* ── Checked in: the undo is offered, and it works — the desk clerk's ordinary mistake. ── */
  await expect(button(copy.undoCheckIn)).toBeVisible();
  await expect(button(copy.completeStay)).toBeVisible();

  await button(copy.undoCheckIn).click();
  await expect(page.getByText(copy.checkInUndone)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(pill, 'the undo goes back to confirmed and no further').toHaveText(
    t.bookingStatus['confirmed'] ?? '',
  );

  /* ── And forward again, to the end. ── */
  await button(copy.checkIn).click();
  await expect(page.getByText(copy.checkedIn)).toBeVisible({ timeout: 20_000 });
  await page.reload();

  await button(copy.completeStay).click();
  await expect(page.getByText(copy.stayCompleted)).toBeVisible({ timeout: 20_000 });
  await expect(pill).toHaveText(t.bookingStatus['completed'] ?? '');

  /*
    A completed stay offers nothing, and that is the assertion.

    §6.2 gives `completed` no outgoing edge except a dispute, and there is no route for that yet
    (`O-book-3`). Every control being gone is what a terminal state looks like — and the
    confirmation above survived the refresh that removed the last of them, which is `O-staff-6`.
  */
  await page.reload();
  for (const label of [
    copy.confirmBooking,
    copy.checkIn,
    copy.undoCheckIn,
    copy.completeStay,
    copy.cancelBooking,
    copy.capturePayment,
  ]) {
    await expect(button(label), `${label} must be gone`).toHaveCount(0);
  }
});

/**
 * Confirming receipt of a transfer is offered for an OFFLINE rail and no other.
 *
 * Bashar asked (2026-08-25) why a human confirms a payment a provider has verified. He is right,
 * and the SRS agrees: §6.2 gives `Payment Pending` to «النظام/بوابة الدفع» — the system and the
 * payment gateway — and names no human. The control exists only because ADR 0002 leaves SAFRA one
 * operable rail with no gateway behind it: a SEPA transfer, which sends no webhook.
 *
 * So the assertion in a browser is the ABSENCE: an ordinary unpaid booking, whose attempt is on a
 * rail that reports for itself, must not offer it. The presence case needs an offline attempt and
 * is asserted in `booking-actions-offered.integration.test.ts`, where one can be created.
 */
test('confirming receipt is not offered on a booking whose rail reports for itself', async ({
  page,
}) => {
  await page.goto('/bookings?status=pending_payment&size=5');

  const row = page.locator('a[href^="/bookings/BKG-"]').first();

  test.skip((await row.count()) === 0, 'No booking is awaiting payment.');

  await page.goto(`/bookings/${(await row.innerText()).trim()}`);

  await expect(page.locator('[data-status-pill]').first()).toHaveText(
    t.bookingStatus['pending_payment'] ?? '',
  );
  await expect(
    page.getByRole('button', { name: copy.capturePayment, exact: true }),
    'a card is captured by its webhook, never by an operator',
  ).toHaveCount(0);
});

/**
 * Cancelling, on a booking that can be cancelled.
 *
 * Its own test because cancellation is terminal: folding it into the lifecycle walk above would
 * end that booking before it could reach `completed`, and completing a stay is the move that had
 * no writer at all until 2026-08-25.
 */
test('a staff cancellation closes the booking and puts its reason on the record', async ({
  page,
}) => {
  await page.goto('/bookings?status=pending_confirmation&size=5');

  /*
    DISTINCT references, not the second anchor.

    Every row carries TWO links to the same booking — the reference and «فتح الملف» — so
    `nth(1)` is the first booking's other link, which is the booking the lifecycle test has just
    walked to `completed`. It offered no cancel control and this timed out waiting for one.
  */
  const references = [
    ...new Set(
      (
        await page
          .locator('a[href^="/bookings/BKG-"]')
          .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
      )
        .map((href) => /BKG-[\w-]+/.exec(href)?.[0] ?? '')
        .filter(Boolean),
    ),
  ];

  test.skip(references.length < 2, 'Not enough bookings awaiting confirmation.');

  const reference = references[1] ?? '';

  await page.goto(`/bookings/${reference}`);
  await page.getByRole('button', { name: copy.cancelBooking, exact: true }).click();
  await expect(page.getByText(copy.cancelHint)).toBeVisible();
  await page.getByLabel(copy.cancelReasonLabel).fill(CANCEL_REASON);
  await page
    .getByRole('button', { name: copy.cancelBooking, exact: true })
    .last()
    .click();
  await expect(page.getByText(copy.bookingCancelled)).toBeVisible({ timeout: 20_000 });

  await page.reload();
  await expect(page.locator('[data-status-pill]').first()).toHaveText(
    t.bookingStatus['cancelled'] ?? '',
  );
  /* The reason reaches the RECORD, not just the request — the customer reads it. */
  await expect(
    page.locator('section').filter({ hasText: copy.cancellation }).last(),
  ).toContainText(CANCEL_REASON);
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

/**
 * §9.4's three remaining actions: a dispute, a refund and a compensation.
 *
 * ## The dispute is the one with consequences
 *
 * Opening it moves the booking to `disputed`, freezes the partner's payout, and — the part that
 * decided the design — must NOT release the nights. `booking-dispute.integration.test.ts` asks the
 * database that question directly, because it is the only place it can be asked. What this adds is
 * the half a browser can see: the warning appears before the field, the status moves on screen, and
 * the cross-link's count follows.
 *
 * ## It leaves the booking disputed
 *
 * Closing it needs النزاعات, which is a different screen and a different test's business. One
 * dispute per run on one fixture booking, which is the same trade `enforcement.spec.ts` documents.
 */
test('a dispute opened here moves the booking and shows on its links', async ({
  page,
}) => {
  await page.goto('/bookings?status=confirmed&size=5');

  const references = [
    ...new Set(
      (
        await page
          .locator('a[href^="/bookings/BKG-"]')
          .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
      )
        .map((href) => /BKG-[\w-]+/.exec(href)?.[0] ?? '')
        .filter(Boolean),
    ),
  ];

  test.skip(references.length === 0, 'No confirmed booking to dispute.');

  /*
    A booking with NO dispute on it yet, found rather than assumed.

    This took the first confirmed booking and opened a dispute on it. That works once: the API
    answers `dispute.already_open` (409) to a second one, so every run after the first hit the same
    fixture and failed with an error that has no relationship to what the test is about. Measured
    2026-08-27 on `BKG-2026-077080`, which had accumulated FOUR open disputes from repeated runs
    since 2026-08-23 while still listing as `confirmed`.

    «لا نزاعات» is the zero case of the related-disputes plural, so the link text is the cheapest
    reading of «has this one been used already» — and it is the same element the assertion at the
    foot compares against, so nothing extra is loaded to find it.
  */
  let reference = '';

  for (const candidate of references) {
    await page.goto(`/bookings/${candidate}`);

    const link = page.locator(`a[href="/disputes?q=${candidate}"]`);

    if ((await link.count()) === 0) continue;

    if ((await link.innerText()).includes(NO_DISPUTES)) {
      reference = candidate;
      break;
    }
  }

  test.skip(
    reference === '',
    'Every confirmed booking on page one already has a dispute.',
  );

  const before = await page.locator(`a[href="/disputes?q=${reference}"]`).innerText();

  await page.getByRole('button', { name: copy.openDispute, exact: true }).click();

  /* Both consequences on screen before the first field — frozen money, and a changed status. */
  await expect(page.getByText(copy.disputeHint)).toBeVisible();

  const form = page
    .locator('main form')
    .filter({ has: page.locator('select[name="kind"]') });

  await form.locator('select[name="kind"]').selectOption('not_as_described');
  await form.locator('input[name="title"]').fill('الغرفة لا تطابق الصور المنشورة');
  await form
    .locator('textarea[name="description"]')
    .fill('اتصل العميل وأفاد بأن الغرفة أصغر بكثير مما ظهر في صور الإعلان.');
  await form.getByRole('button', { name: copy.openDispute }).click();

  await expect(page.getByText(copy.disputeOpened)).toBeVisible({ timeout: 20_000 });

  await page.reload();

  await expect(page.locator('[data-status-pill]').first()).toHaveText(
    t.bookingStatus['disputed'] ?? '',
  );

  /* The count moved with it — a link that still said «لا نزاعات» would be the failure it exists to prevent. */
  await expect(page.locator(`a[href="/disputes?q=${reference}"]`)).not.toHaveText(before);
});

/**
 * The refund quote is on screen BEFORE the button that issues it.
 *
 * A refund is irreversible and its size depends on when the customer is cancelling, so an operator
 * who cannot see the figure until afterwards is guessing. The amount is never sent — `RefundService`
 * computes it from the policy snapshotted on the booking — and the hint says so, which is what stops
 * somebody looking for a field that does not exist.
 *
 * Deliberately does NOT issue one: a refund moves real money and cannot be undone, and the endpoint
 * itself is covered by `payments.integration.test.ts`. What was missing was the surface.
 */
test('the refund form shows what the policy would return, before issuing anything', async ({
  page,
}) => {
  await page.goto('/bookings?status=confirmed&size=5');

  const row = page.locator('a[href^="/bookings/BKG-"]').first();

  test.skip((await row.count()) === 0, 'No paid booking to quote a refund on.');

  await page.goto(`/bookings/${(await row.innerText()).trim()}`);
  await page.getByRole('button', { name: copy.refund, exact: true }).click();

  await expect(page.getByText(copy.refundHint)).toBeVisible();

  const form = page.locator('main form').filter({ hasText: copy.refundReasonLabel });

  /* The quote arrives from `refund-quote`; the currency code is the part that proves it landed. */
  await expect(form).toContainText(/USD|EUR|SYP/, { timeout: 20_000 });
});

/**
 * Compensation credits the wallet, and the currency is a CHOICE from what SAFRA compensates in.
 *
 * The select is asserted against the three codes rather than merely being present: a text box here
 * would accept `JOD`, and `COMPENSATION_CURRENCIES` exists because a menu that offers three while
 * the endpoint takes any code is a restriction in appearance only.
 */
test('compensating a customer credits their wallet in one of the three currencies', async ({
  page,
}) => {
  await page.goto('/bookings?status=confirmed&size=5');

  const row = page.locator('a[href^="/bookings/BKG-"]').first();

  test.skip((await row.count()) === 0, 'No booking to compensate against.');

  await page.goto(`/bookings/${(await row.innerText()).trim()}`);
  await page.getByRole('button', { name: copy.compensate, exact: true }).click();

  await expect(page.getByText(copy.compensateHint)).toBeVisible();

  /*
    Scoped to the compensation form, and it has to be: the internal-notes textarea is also
    `name="note"`, it is earlier in the DOM, and an unscoped locator fills the wrong one.
  */
  const form = page
    .locator('main form')
    .filter({ has: page.locator('input[name="amount"]') });

  expect(
    await form.locator('select[name="currency"] option').allInnerTexts(),
    'the three SAFRA compensates in, and no free-text code',
  ).toEqual([...COMPENSATION_CURRENCIES]);

  await form.locator('input[name="amount"]').fill('10.00');
  await form
    .locator('textarea[name="note"]')
    .fill('تعويض اختباري عن عدم مطابقة الوصف، من مجموعة الاختبارات.');
  await form.getByRole('button', { name: copy.compensate }).click();

  await expect(page.getByText(copy.compensated)).toBeVisible({ timeout: 20_000 });
});

/**
 * EC-011's alert, and the one thing that makes an alert worth having.
 *
 * The dashboard says a number and links somewhere. If the row's count and the destination's total
 * disagree, the operator meets one figure on the dashboard and another on the registry — and stops
 * believing both. `booking-attention.integration.test.ts` holds the two predicates equal in the
 * database; this holds them equal ON SCREEN, which is where the disagreement would be read.
 *
 * Skips when the count is zero, because there is then no row to follow — and a zero is a legitimate
 * state, not a broken fixture.
 */
test('the arrivals alert links to a list of exactly that many bookings', async ({
  page,
}) => {
  await page.goto('/');

  const row = page.locator('a[href="/bookings?attention=no_check_in"]').first();

  test.skip(
    (await row.count()) === 0,
    'No stay is missing a check-in — nothing to follow.',
  );

  /*
    The element carrying the SENTENCE, not an ancestor that happens to contain it.

    A `li, div` filter matched the whole panel first, and the leading number it returned was the
    rows-per-page select's «25» — a figure with no relationship to the alert. `getByText` on the
    phrase lands on the element the count is prefixed to.
  */
  const alert = await page
    .getByText(t.admin.attentionArrivals, { exact: false })
    .first()
    .innerText();

  const claimed = /[\d,]+/.exec(alert)?.[0];

  expect(claimed, 'the alert states a number').toBeTruthy();

  await row.click();
  await page.waitForURL(/attention=no_check_in/);

  /* The pager's total is the FILTERED one — the toolbar's note counts the whole registry. */
  const total = /[\d,]+/.exec(
    (await page.locator('main').innerText())
      .split('\n')
      .find((line) => /نتيجة|نتائج/.test(line)) ?? '',
  )?.[0];

  expect(total, 'the dashboard number is the number of rows behind the link').toBe(
    claimed,
  );

  /* And every one of them really is a confirmed stay — a filter that matched everything would pass the count. */
  const statuses = [...new Set(await page.locator('[data-status-pill]').allInnerTexts())];

  expect(statuses).toEqual([t.bookingStatus['confirmed'] ?? '']);
});
