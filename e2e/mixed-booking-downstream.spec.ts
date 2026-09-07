import { expect, test, type Page } from '@playwright/test';

import { PARTNER_BASE, PARTNER_STATE } from './partner-session.js';
import { STAFF_STATE } from './staff.js';

/**
 * A booking of SEVERAL room types, followed to every document and screen it produces.
 *
 * ## Why this exists
 *
 * `bookings.unit_id` is the LEAD line. Every surface that rendered a booking's accommodation read
 * that one column, which was the whole truth while a booking held one type and became one of
 * several the moment a basket could mix them: a voucher describing a suite on a booking that also
 * holds two double rooms is a document reception cannot act on, and an invoice whose total has an
 * invisible component is one an accounts department cannot reconcile.
 *
 * None of that would fail a test of the booking flow, because the booking flow is correct. So this
 * books a genuinely mixed basket and then goes and LOOKS at each surface in turn.
 */
const SLUG = 'grand-umayyad-hotel';
const WEB = 'http://localhost:3000';
const CONSOLE = 'http://localhost:3001';
const MAILPIT = 'http://localhost:8025';

/** Its own nights, so a re-run never measures the previous run's leftovers. */
const STAY = (() => {
  const at = new Date();

  at.setUTCDate(at.getUTCDate() + 120 + (Date.now() % 420));

  const checkIn = at.toISOString().slice(0, 10);

  at.setUTCDate(at.getUTCDate() + 2);

  return { checkIn, checkOut: at.toISOString().slice(0, 10) };
})();

test.describe.configure({ mode: 'serial' });

let reference = '';
let types: string[] = [];

/** The rows that can be added, resolved ONCE — the label changes when a row is added. */
async function addableIndices(page: Page): Promise<number[]> {
  const rows = page.locator('#units > ul > li');
  const count = await rows.count();
  const found: number[] = [];

  for (let i = 0; i < count; i += 1) {
    if ((await rows.nth(i).getByRole('button', { name: 'أضف إلى الحجز' }).count()) > 0) {
      found.push(i);
    }
  }

  return found;
}

test('a guest books two room types in one booking', async ({ page }) => {
  console.log(`stay: ${STAY.checkIn} → ${STAY.checkOut}`);

  await page.goto(
    `${WEB}/ar/property/${SLUG}?checkIn=${STAY.checkIn}&checkOut=${STAY.checkOut}&adults=2`,
    { waitUntil: 'domcontentloaded' },
  );

  const indices = await addableIndices(page);

  expect(indices.length, 'the hotel offers more than one type').toBeGreaterThan(1);

  const rows = page.locator('#units > ul > li');
  const add = (i: number) =>
    rows.nth(i).getByRole('button', { name: /أضف إلى الحجز|في الحجز/ });

  /* Two of the first type and one of the second — the shape a family actually books. */
  types = [
    (await rows.nth(indices[0]!).locator('h3').innerText()).trim(),
    (await rows.nth(indices[1]!).locator('h3').innerText()).trim(),
  ];

  await add(indices[0]!).click();
  await add(indices[0]!).click();
  await add(indices[1]!).click();

  const card = page.locator('aside#booking');

  await expect(card.locator('[data-basket-line]'), 'two lines').toHaveCount(2);
  await card.getByRole('link', { name: 'احجز الآن' }).click();
  await page.waitForURL(/\/checkout\?/);

  /* ── Checkout names BOTH types ────────────────────────────────────────────── */
  const basket = page.locator('[data-checkout-basket] li');

  await expect(basket, 'checkout lists both types').toHaveCount(2);

  for (const type of types) {
    await expect(page.locator('main'), `${type} is named`).toContainText(type);
  }

  await page.getByLabel('الاسم الكامل').fill('عائلة الغرف المختلطة');
  await page.getByLabel('البريد الإلكتروني').fill('mixed@safra.test');
  await page.getByLabel('رقم الهاتف (واتساب)').fill('933555666');

  const created = page.waitForResponse(
    (r) => r.url().includes('/api/bookings') && r.request().method() === 'POST',
  );

  await page.getByRole('button', { name: 'تابع إلى الدفع' }).click();

  const body = (await (await created).json()) as { reference: string };

  reference = body.reference;

  expect(reference, 'the booking exists').toMatch(/^BKG-/);

  await page.waitForURL(/payments\/return|\/booking\//, { timeout: 30_000 });
});

test('the console shows the composition, and finance captures it', async ({
  browser,
}) => {
  expect(reference).not.toBe('');

  const staff = await browser.newContext({ storageState: STAFF_STATE });
  const page = await staff.newPage();

  try {
    await page.goto(`${CONSOLE}/bookings/${reference}`, {
      waitUntil: 'domcontentloaded',
    });

    const main = page.locator('main');

    await expect(main, 'the console found it').toContainText(reference, {
      timeout: 20_000,
    });

    /*
      BOTH types. The console read `bookings.unit_id`'s name, so an operator asked «what did they
      book» would have named one of two.
    */
    for (const type of types) {
      await expect(main, `${type} is on the console`).toContainText(type);
    }

    const capture = page.getByRole('button', {
      name: 'تأكيد استلام الحوالة',
      exact: true,
    });

    await expect(capture).toBeVisible();
    await capture.click();

    const dialog = page.getByRole('alertdialog');

    if (await dialog.isVisible().catch(() => false)) {
      await dialog.getByRole('button', { name: 'تأكيد' }).click();
    }

    await expect(page.locator('[data-status-pill]').first()).toHaveText('قيد التأكيد', {
      timeout: 20_000,
    });
  } finally {
    await staff.close();
  }
});

test('the partner’s queue names both types, then accepts', async ({ browser }) => {
  expect(reference).not.toBe('');

  const partner = await browser.newContext({
    storageState: PARTNER_STATE,
    baseURL: PARTNER_BASE,
  });
  const page = await partner.newPage();

  try {
    await page.goto(`${PARTNER_BASE}/`, { waitUntil: 'domcontentloaded' });

    const queue = page.locator('main');

    await expect(queue, 'the request reached the partner').toContainText(reference, {
      timeout: 20_000,
    });

    /*
      A partner has two hours to accept, and «3 غرف» does not say whether that is three doubles or
      a double, a family room and a suite. Those are different rooms to prepare.
    */
    for (const type of types) {
      await expect(queue, `${type} is in the queue`).toContainText(type);
    }

    const card = page.locator('li', { hasText: reference }).first();
    const accept = card.getByRole('button', { name: 'قبول', exact: true });

    await accept.click();

    const accepted = page.waitForResponse(
      (r) => r.url().includes('/decision') && r.request().method() === 'POST',
    );

    await accept.click();
    expect((await accepted).status()).toBeLessThan(300);
  } finally {
    await partner.close();
  }
});

test('the confirmation email names every type it booked', async ({ request }) => {
  expect(reference).not.toBe('');

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
    Every type, in the message itself.

    It named the LEAD type, so a guest who booked a double and a suite was told about one of them —
    while the voucher attached to the same mail listed both. A message disagreeing with its own
    attachment is the shape this assertion exists to catch.
  */
  for (const type of types) {
    expect(body, `the email names ${type}`).toContain(type);
  }

  /* And the voucher still rides with it. */
  const { Attachments } = JSON.parse(body) as {
    Attachments?: { ContentType: string }[];
  };

  expect(Attachments?.[0]?.ContentType).toBe('application/pdf');
});
