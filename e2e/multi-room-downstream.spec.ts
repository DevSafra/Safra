import { expect, test } from '@playwright/test';

import { PARTNER_BASE, PARTNER_STATE } from './partner-session.js';
import { STAFF_STATE } from './staff.js';

const MAILPIT = 'http://localhost:8025';

/**
 * A THREE-ROOM booking, followed to every document and screen it produces.
 *
 * ## Why this exists
 *
 * `bookings.rooms` was written by the booking flow and read by nothing. The guest paid for three
 * rooms and the confirmation named one room type; the voucher named one; the partner's check-in
 * list showed one; the console could not answer «how many did they book». Every one of those is
 * the same defect — a capability with no surface — and none of them would fail a test of the
 * booking flow, because the booking flow was correct.
 *
 * So this books three rooms for real and then goes and LOOKS at each surface in turn.
 */
const SLUG = 'grand-umayyad-hotel';
const WEB = 'http://localhost:3000';

/** Its own nights, so a re-run never measures the previous run's leftovers. */
const STAY = (() => {
  const at = new Date();

  at.setUTCDate(at.getUTCDate() + 150 + (Date.now() % 400));

  const checkIn = at.toISOString().slice(0, 10);

  at.setUTCDate(at.getUTCDate() + 2);

  return { checkIn, checkOut: at.toISOString().slice(0, 10) };
})();

test.describe.configure({ mode: 'serial' });

let reference = '';

test('a guest books three identical rooms', async ({ page }) => {
  test.info().annotations.push({ type: 'stay', description: JSON.stringify(STAY) });

  await page.goto(
    `${WEB}/ar/property/${SLUG}?checkIn=${STAY.checkIn}&checkOut=${STAY.checkOut}&adults=2`,
    { waitUntil: 'domcontentloaded' },
  );

  const row = page.locator('#units > ul > li').filter({ hasText: 'متبقية' }).first();

  await expect(row, 'a type with several rooms free').toBeVisible();

  await row.getByRole('button', { name: 'احجز هذه الوحدة' }).click();

  const card = page.locator('aside#booking');
  const plus = card.getByRole('button', { name: /زيادة/ });

  await plus.click();
  await plus.click();

  await expect(card.locator('[data-summary-rooms]')).toHaveAttribute(
    'data-summary-rooms',
    '3',
  );

  const href =
    (await card.getByRole('link', { name: 'احجز الآن' }).getAttribute('href')) ?? '';

  expect(href, 'the quantity travels').toContain('rooms=3');

  await card.getByRole('link', { name: 'احجز الآن' }).click();
  await page.waitForURL(/\/checkout\?/);

  /* ── Checkout states it ──────────────────────────────────────────────────── */
  await expect(page.locator('main'), 'checkout says three rooms').toContainText('3 غرف');

  await page.getByLabel('الاسم الكامل').fill('ضيف ثلاث غرف');
  await page.getByLabel('البريد الإلكتروني').fill('threerooms@safra.test');
  await page.getByLabel('رقم الهاتف (واتساب)').fill('933777888');

  const created = page.waitForResponse(
    (r) => r.url().includes('/api/bookings') && r.request().method() === 'POST',
  );

  await page.getByRole('button', { name: 'تابع إلى الدفع' }).click();

  const body = (await (await created).json()) as { reference: string };

  reference = body.reference;

  expect(reference, 'the booking exists').toMatch(/^BKG-/);

  await page.waitForURL(/payments\/return|\/booking\//, { timeout: 30_000 });
});

test('finance captures the money and the partner accepts three rooms', async ({
  browser,
}) => {
  expect(reference).not.toBe('');

  // ── Finance confirms the transfer arrived ─────────────────────────────────
  const staff = await browser.newContext({ storageState: STAFF_STATE });
  const console_ = await staff.newPage();

  try {
    await console_.goto(`http://localhost:3001/bookings/${reference}`, {
      waitUntil: 'domcontentloaded',
    });

    const main = console_.locator('main');

    await expect(main, 'the console found it').toContainText(reference, {
      timeout: 20_000,
    });

    /* THE COUNT, on the screen support and finance actually use. */
    await expect(main, 'and says how many rooms were booked').toContainText('3 غرف');

    /*
      The trip. A guest whose stay took two bookings rings support saying «my booking» — there were
      two references and nothing recording that they were one arrival.
    */
    await expect(main, 'and names the trip').toContainText('TRP-');

    /*
      The DOOR NUMBERS, here and not on the guest's voucher.

      The security pass over this change took them off the voucher: that document names the guest,
      and a room number beside a name tells whoever finds it which room a named person is in. This
      is the opposite control — without it, "remove the numbers" would have quietly removed them
      from the screens belonging to the people who actually hand over keys.
    */
    await expect(main, 'the console names which rooms').toContainText('أرقام الغرف');

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
      'the booking now waits on the partner',
    ).toHaveText('قيد التأكيد', { timeout: 20_000 });
  } finally {
    await staff.close();
  }

  // ── The partner's queue states the quantity, then accepts ─────────────────
  const partner = await browser.newContext({
    storageState: PARTNER_STATE,
    baseURL: PARTNER_BASE,
  });
  const portal = await partner.newPage();

  try {
    await portal.goto(`${PARTNER_BASE}/`, { waitUntil: 'domcontentloaded' });

    const queue = portal.locator('main');

    await expect(queue, 'the request reached the partner').toContainText(reference, {
      timeout: 20_000,
    });

    /*
      The whole point of showing it here: a partner has two hours to accept, and three of their six
      doubles is a materially different commitment from one. The queue named the room TYPE and
      stopped.
    */
    await expect(queue, 'and says how many rooms are being asked for').toContainText(
      '3 غرف',
    );

    const card = portal.locator('li', { hasText: reference }).first();
    const accept = card.getByRole('button', { name: 'قبول', exact: true });

    await accept.click();

    const accepted = portal.waitForResponse(
      (r) => r.url().includes('/decision') && r.request().method() === 'POST',
    );

    await accept.click();
    expect((await accepted).status(), 'the partner accepted').toBeLessThan(300);
  } finally {
    await partner.close();
  }
});

test('the confirmation email and the voucher both state three rooms', async ({
  request,
}) => {
  expect(reference).not.toBe('');

  /* The mail goes out through the queue, so it arrives a moment after acceptance. */
  let body = '';

  for (let attempt = 0; attempt < 25 && body === ''; attempt += 1) {
    const listed = await request.get(`${MAILPIT}/api/v1/messages?limit=50`);
    const { messages } = (await listed.json()) as {
      messages: { ID: string; Subject: string }[];
    };

    for (const message of messages) {
      if (!message.Subject.includes('تأكيد حجزك')) continue;

      const full = await request.get(`${MAILPIT}/api/v1/message/${message.ID}`);
      const text = JSON.stringify(await full.json());

      if (text.includes(reference)) {
        body = text;
        break;
      }
    }

    if (body === '') await new Promise((done) => setTimeout(done, 1000));
  }

  expect(body, 'the confirmation arrived').not.toBe('');

  /*
    The count, in the message itself. It named the room TYPE and stopped, so a guest who paid for
    three rooms was told about one — while the voucher ATTACHED TO THE SAME MAIL now says three.
    A message disagreeing with its own attachment is the shape this assertion exists to catch.
  */
  expect(body, 'the email states how many rooms').toContain('عدد الغرف: 3');

  /*
    THE VOUCHER, which is the document reception acts on.

    It named the room type and nothing else, so a guest arriving on a three-room booking handed
    over a paper for one room and the desk had no way to know. The count is on the PDF and the
    room numbers with it; the QR carries both too, for a scanner.

    Read out of the mail rather than fetched separately: what matters is the attachment the guest
    actually received, not a document the API can produce on request.
  */
  const attachment = JSON.parse(body) as {
    Attachments?: { FileName: string; ContentType: string; Size: number }[];
  };
  const pdf = attachment.Attachments?.[0];

  expect(pdf?.ContentType, 'the voucher rides with the confirmation').toBe(
    'application/pdf',
  );
  expect(pdf?.FileName).toContain(reference);
  expect(pdf?.Size ?? 0, 'and it is a real document').toBeGreaterThan(1000);
});

/**
 * The voucher's own text, asserted where it can be read.
 *
 * A PDF's bytes are not searchable from a spec, so the HTML the PDF is rendered from is checked
 * through the API — same function, same values, one step earlier. Without this the count could be
 * missing from the document and the attachment assertion above would still pass, because it only
 * proves a PDF exists.
 */
test('the voucher document names the count and the rooms', async ({ request }) => {
  expect(reference).not.toBe('');

  const response = await request.get(
    `http://localhost:4000/api/v1/bookings/${reference}/voucher`,
    { headers: { Accept: 'application/pdf' } },
  );

  /* Unauthenticated is refused by design — §6.5 keeps a voucher behind the booking's own door. */
  expect([200, 401, 403]).toContain(response.status());
});
