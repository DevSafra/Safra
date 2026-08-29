import { expect, test } from '@playwright/test';

import { adminAr as t } from '../packages/i18n/src/admin.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * الرسائل — SAFRA writing first, and the thread saying what it is.
 *
 * ## What a browser adds
 *
 * `start-conversation.integration.test.ts` proves the shapes, the scoping and the refusals against
 * a real database. What it cannot see is whether an operator can DO any of it: the composer, the
 * three links that prefill it, the party line and the kind pill are four server components and a
 * proxy route deep, and every one of them can be wired to nothing while the API is perfect.
 *
 * Bashar read this screen on 2026-08-29 and said he was confused. He was reading «فندق قصر الشرق ↔
 * سفرة ↔ فندق قصر الشرق» — one host on both sides of a three-party template — over a list with no
 * way to start a conversation at all. Both halves are asserted here.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.use({ storageState: STAFF_STATE });

const c = t.sections.messages;

test('writes to a customer from their own record, and the thread says who it is with', async ({
  page,
}) => {
  await page.goto('/customers?size=5');

  const record = page.locator('a[href^="/customers/CUS-"]').first();

  /* Narrower than «no link»: an empty registry is the only honest reason to skip. */
  test.skip((await record.count()) === 0, 'No customer to write to.');

  await page.goto((await record.getAttribute('href')) ?? '/customers');

  /*
    The entry point Bashar asked for. A link rather than a form — it carries the recipient into
    الرسائل's composer, which is the one place a conversation is started.
  */
  await page.getByRole('link', { name: c.messageAction }).click();
  await page.waitForURL(/\/messages\?to=customer/);

  /* Arriving with a recipient opens the composer by itself, with the reference already in it. */
  /*
    By NAME, not by position. `input` matched the pager's page-number box first — the composer is
    above the list and the list carries controls of its own.
  */
  await expect(page.locator('input[name=reference]')).toHaveValue(/^CUS-/);

  await page.locator('textarea[name=body]').fill('نتابع معك تفاصيل إقامتك القادمة.');
  await page.getByRole('button', { name: c.composeSend, exact: true }).click();

  await page.waitForURL(/\/messages\/CNV-/, { timeout: 20_000 });

  /*
    The header, which did not exist: the screen printed a bare CNV reference over a list of
    messages and named nobody. «دعم» because a thread to a customer is about nothing else.
  */
  const header = page.locator('main');

  await expect(header).toContainText('↔ سفرة');
  await expect(header).toContainText(c.kindSupport);
  await expect(page.locator('ul')).toContainText('نتابع معك تفاصيل إقامتك القادمة.');

  /* A two-party thread does not claim to be a three-party one. */
  await expect(header).toContainText(c.noteTwoParty);
});

/**
 * «Both of them at the same time» — the three-party thread.
 *
 * `conversations.booking_id` has existed since the first migration with no writer, so the record
 * the whole design describes — customer, SAFRA, host, one ordered thread — had never been created.
 * This is the assertion that it now is, and that the screen names both sides of it.
 */
test('writes to the customer and the host together, from the booking', async ({
  page,
}) => {
  await page.goto('/bookings?status=confirmed&size=5');

  const row = page.locator('a[href^="/bookings/BKG-"]').first();

  test.skip((await row.count()) === 0, 'No booking to write about.');

  await page.goto((await row.getAttribute('href')) ?? '/bookings');
  await page.getByRole('link', { name: c.messageAction }).click();
  await page.waitForURL(/\/messages\?to=booking/);

  await page.locator('textarea[name=body]').fill('نتابع معكما موعد الوصول لهذا الحجز.');
  await page.getByRole('button', { name: c.composeSend, exact: true }).click();
  await page.waitForURL(/\/messages\/CNV-/, { timeout: 20_000 });

  const header = page.locator('main');

  /* THREE parties named, and the booking it is about, reachable from here. */
  await expect(header).toContainText(c.kindBooking);
  await expect(page.locator('a[href^="/bookings/BKG-"]').first()).toBeVisible();
  await expect(header).toContainText(c.note);

  const line = (await header.textContent()) ?? '';
  const parties = line.split('↔');

  expect(
    parties.length,
    'a booking thread names both sides of it',
  ).toBeGreaterThanOrEqual(3);
});

/**
 * Every row says what KIND of thread it is, and names only the people actually in it.
 *
 * Four shapes render in this list and they were told apart only by decoding a reference prefix —
 * and a ticket had no subject reference of its own, so two tickets from one host were
 * indistinguishable. A host's own thread came out with the host on both sides of «↔ سفرة ↔».
 */
test('names every row by its kind, and nobody twice', async ({ page }) => {
  await page.goto('/messages?size=25');

  const rows = page.locator('ul > li');

  test.skip((await rows.count()) === 0, 'No conversation in the inbox.');

  const kinds = [c.kindBooking, c.kindDispute, c.kindPartner, c.kindSupport];

  for (const text of await rows.allInnerTexts()) {
    const flat = text.replace(/\s+/g, ' ');

    expect(
      kinds.some((kind) => flat.includes(kind)),
      `every row states what it is: ${flat.slice(0, 80)}`,
    ).toBe(true);
  }

  /*
    The party LINE, read from its own element.

    Over the row's whole text this was vacuous — the avatar glyph is part of it, so comparing the
    first party against the last compared «ف فندق قصر الشرق» with «فندق قصر الشرق» and passed over
    the defect it exists for. `data-parties` carries the thread's kind, which is what decides how
    many parties the line is allowed to name.
  */
  const lines = page.locator('ul > li [data-parties]');

  for (let index = 0; index < (await lines.count()); index += 1) {
    const line = lines.nth(index);
    const kind = await line.getAttribute('data-parties');
    const text = ((await line.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    const parties = text.split('↔').map((part) => part.trim());

    /*
      Only a BOOKING has three. Everything else had the third slot filled with the same party
      twice — «فندق قصر الشرق ↔ سفرة ↔ فندق قصر الشرق» — or with an em dash standing in for
      somebody who is not in the conversation and never was.
    */
    expect(parties, `${kind} names the wrong number of parties: ${text}`).toHaveLength(
      kind === 'booking' ? 3 : 2,
    );
    expect(new Set(parties).size, `a party is named twice: ${text}`).toBe(parties.length);
  }
});
