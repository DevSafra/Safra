import { expect, test, type Page } from '@playwright/test';

import { PARTNER_BASE, PARTNER_STATE } from './partner-session.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * From «تابع إلى الدفع» to a voucher, on a hotel with thirteen rooms.
 *
 * Bashar, 2026-09-06: *"Do not treat reading the code as equivalent to driving the journey."* The
 * sibling spec proves the room a guest picks reaches the database. This proves it survives the rest
 * of the way — the finance capture, the partner's acceptance, the email, the voucher, its QR and
 * the receipt — and that every one of those surfaces names the ROOM and not just the hotel.
 *
 * ## Why the whole chain is one test
 *
 * Each step only exists because of the one before it. A voucher test seeded straight into
 * `confirmed` would prove a template renders; what is in question is whether a booking made by
 * choosing «جناح تنفيذي» on a page still says «جناح تنفيذي» after two staff actions, a queue and a
 * PDF. That is a property of the CHAIN.
 *
 * ## The rail is offline, and that is the point
 *
 * No card acquirer is registered, so checkout routes to a bank transfer: the booking waits at
 * `pending_payment` until finance confirms the money arrived. That capture is a real operator
 * action on a real screen, and it is the step this journey had never been driven through.
 */
const SLUG = 'grand-umayyad-hotel';
const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';
const ROOM = 'جناح تنفيذي';

/** Far enough out that the seeder's own bookings never collide, and unique per run. */
const STAY = (() => {
  const at = new Date();

  at.setUTCDate(
    at.getUTCDate() + 400 + ((at.getUTCHours() * 60 + at.getUTCMinutes()) % 90),
  );

  const checkIn = at.toISOString().slice(0, 10);

  at.setUTCDate(at.getUTCDate() + 2);

  return { checkIn, checkOut: at.toISOString().slice(0, 10) };
})();

test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 1000 } });

/** The guest's own booking, made by choosing a room on the page. */
async function bookTheSuite(page: Page): Promise<string> {
  await page.goto(
    `http://localhost:3000/ar/property/${SLUG}?checkIn=${STAY.checkIn}&checkOut=${STAY.checkOut}&adults=2`,
    { waitUntil: 'domcontentloaded' },
  );

  const row = page.locator('#units > ul > li').filter({ hasText: ROOM });

  /*
    Choose on the row, commit on the card. The row used to link straight to checkout; it now fills
    the summary beside the page and «احجز الآن» there is the commitment — so this walks the two
    acts a guest actually performs.
  */
  await row.getByRole('button', { name: 'احجز هذه الوحدة' }).click();
  await page.locator('aside#booking').getByRole('link', { name: 'احجز الآن' }).click();
  await page.waitForURL(/\/checkout\?/);

  await expect(page.locator('aside'), 'checkout names the room').toContainText(ROOM);

  await page.getByLabel('الاسم الكامل').fill('ضيف الرحلة الكاملة');
  await page.getByLabel('البريد الإلكتروني').fill('journey@safra.test');
  await page.getByLabel('رقم الهاتف (واتساب)').fill('933444555');

  const created = page.waitForResponse(
    (r) => r.url().includes('/api/bookings') && r.request().method() === 'POST',
  );

  await page.getByRole('button', { name: 'تابع إلى الدفع' }).click();

  const response = await created;

  expect(response.status(), 'the booking was created').toBe(201);

  const { reference } = (await response.json()) as { reference: string };

  await page.waitForURL(/payments\/return|\/booking\//, { timeout: 30_000 });

  return reference;
}

test('a chosen room survives capture, acceptance, the email, the voucher and the receipt', async ({
  page,
  browser,
  request,
}) => {
  // ── 1. THE GUEST chooses a room and pays ──────────────────────────────────
  const reference = await bookTheSuite(page);

  console.log('booked:', reference);

  const since = new Date();

  // ── 2. FINANCE confirms the transfer arrived ──────────────────────────────
  const staff = await browser.newContext({ storageState: STAFF_STATE });
  const console_ = await staff.newPage();

  try {
    await console_.goto(`http://localhost:3001/bookings/${reference}`, {
      waitUntil: 'domcontentloaded',
    });

    const main = console_.locator('main');

    await expect(main, 'the console names the room').toContainText(ROOM, {
      timeout: 20_000,
    });

    /*
      «تأكيد استلام الحوالة» — offered only on a booking awaiting an OFFLINE transfer, which is what
      the only registered rail produces. This is the step that had never been driven.
    */
    const capture = console_.getByRole('button', {
      name: 'تأكيد استلام الحوالة',
      exact: true,
    });

    await expect(capture, 'finance can confirm the money arrived').toBeVisible();
    await capture.click();

    const dialog = console_.getByRole('alertdialog');

    if (await dialog.isVisible().catch(() => false)) {
      await dialog.getByRole('button', { name: 'تأكيد' }).click();
    }

    await expect(
      console_.locator('[data-status-pill]').first(),
      'the booking is now waiting on the partner',
    ).toHaveText('قيد التأكيد', { timeout: 20_000 });
  } finally {
    await staff.close();
  }

  // ── 3. THE PARTNER accepts it ─────────────────────────────────────────────
  const partner = await browser.newContext({
    storageState: PARTNER_STATE,
    baseURL: PARTNER_BASE,
  });
  const portal = await partner.newPage();

  try {
    await portal.goto(`${PARTNER_BASE}/`, { waitUntil: 'domcontentloaded' });

    const queue = portal.locator('main');

    await expect(queue, 'the request is in the partner’s queue').toContainText(
      reference,
      { timeout: 20_000 },
    );

    /* The room, in the queue — what the partner has to prepare. */
    await expect(queue, 'and it says which room').toContainText(ROOM);

    /*
      The queue is a `ul` of `li`, not articles — the customer app's property cards are articles and
      this is a different screen. A locator borrowed from the wrong app matches nothing and reads as
      a hang rather than as a mistake.
    */
    const card = portal.locator('li', { hasText: reference }).first();

    /*
      Two presses, and the second is the commitment.

      «قبول» swaps the card into an accept state whose own «قبول» actually sends — an inline
      confirmation rather than a dialog, because accepting binds the partner to the stay and the
      component's note says a partner who has not understood that before pressing has made a
      commitment they did not mean to. So the spec presses twice, like a person.
    */
    const accept = card.getByRole('button', { name: 'قبول', exact: true });

    await accept.click();

    const accepted = portal.waitForResponse(
      (r) => r.url().includes('/decision') && r.request().method() === 'POST',
    );

    await accept.click();
    expect((await accepted).status(), 'the partner accepted it').toBeLessThan(300);

    await expect(queue, 'the request leaves the queue once accepted').not.toContainText(
      reference,
      { timeout: 20_000 },
    );
  } finally {
    await partner.close();
  }

  // ── 4. THE EMAIL names the room ───────────────────────────────────────────
  let mail: { id: string; Subject: string; body: string } | null = null;

  for (let attempt = 0; attempt < 20 && !mail; attempt += 1) {
    const listed = await request.get(`${MAILPIT}/api/v1/messages?limit=40`);
    const { messages } = (await listed.json()) as {
      messages: { ID: string; Subject: string; Created: string }[];
    };

    for (const message of messages) {
      if (new Date(message.Created) < since) continue;

      const full = await request.get(`${MAILPIT}/api/v1/message/${message.ID}`);
      const body = JSON.stringify(await full.json());

      /* The confirmation specifically — the invoice and the partner's request also name it. */
      if (body.includes(reference) && message.Subject.includes('تأكيد حجزك')) {
        mail = { id: message.ID, Subject: message.Subject, body };
        break;
      }
    }

    if (!mail) await page.waitForTimeout(3_000);
  }

  expect(mail, 'a mail about this booking reached the inbox').not.toBeNull();
  console.log('mail subject:', mail?.Subject);

  expect(mail?.body, 'the confirmation names the room, not only the hotel').toContain(
    ROOM,
  );

  // ── 5. THE VOUCHER, where the customer actually gets it ───────────────────
  /*
    From the EMAIL, not from the API.

    §6.5 attaches the voucher rather than linking it, for a guest at a desk with no connection — so
    the mail is the delivery path, and asserting on an authenticated endpoint would test something
    the customer never touches. It is also the assertion that would have failed before 2026-09-06:
    the PDF is a Buffer, BullMQ stores job data as JSON, and it arrived at the mailer as
    `{type:'Buffer',data:[…]}` — every confirmation on the platform failed to send and was written
    down as delivered.
  */
  const message = await request.get(
    `${MAILPIT}/api/v1/message/${(mail as { id: string }).id}`,
  );

  const detail = (await message.json()) as {
    Attachments: { FileName: string; ContentType: string; Size: number }[];
  };

  const pdf = detail.Attachments?.[0];

  console.log('voucher:', pdf?.FileName, pdf?.ContentType, pdf?.Size);

  expect(pdf?.ContentType, 'the voucher rides with the confirmation').toBe(
    'application/pdf',
  );
  expect(pdf?.FileName).toBe(`${reference}.pdf`);
  /* A real document, not a corrupted object serialised into one. */
  expect(pdf?.Size ?? 0, 'and it is a whole PDF').toBeGreaterThan(10_000);

  // ── 6. THE CUSTOMER's own booking, and the receipt ────────────────────────
  const staff3 = await browser.newContext({ storageState: STAFF_STATE });
  const admin = await staff3.newPage();

  try {
    await admin.goto(`http://localhost:3001/bookings/${reference}`, {
      waitUntil: 'domcontentloaded',
    });

    const main = admin.locator('main');

    await expect(main, 'the console still names the room').toContainText(ROOM);
    await expect(
      main.locator('[data-status-pill]').first(),
      'and the booking is confirmed',
    ).toHaveText('مؤكد', { timeout: 20_000 });

    console.log('--- CONSOLE ---\n' + (await main.innerText()).slice(0, 400));
  } finally {
    await staff3.close();
  }
});
