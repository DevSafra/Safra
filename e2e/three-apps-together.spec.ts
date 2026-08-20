import { expect, test } from '@playwright/test';
import { EMAIL, PASSWORD, STAFF_STATE, freshCode } from './staff.js';

/**
 * The three apps as one system: a customer books, the partner is told, the console can see it.
 *
 * ## Why this exists
 *
 * Every other spec verifies one app. This one asserts the SEAMS, because the seams are what nobody
 * looks at: `notifications` had existed since the first migration with nothing ever writing to it,
 * and the delivery log rendered raw template keys for months because the screen that shows them and
 * the catalogue that names them were checked separately.
 *
 * The chain here is the platform's central one, and each link is a different app or process:
 *
 *   customer app → API books it → notification row → SMTP → console's delivery log
 *
 * ## What it does NOT assert
 *
 * Timing. `notify()` sends inside the request today (the accepted deviation under `O-notify-1`), so
 * the row exists by the time the response returns. If BullMQ moves it off the request path this spec
 * needs a poll rather than a straight read — and it should fail loudly at that point rather than
 * quietly race, which is why the assertion is on the row and not on a delay.
 */
const API = 'http://localhost:4000/api/v1';
const MAILPIT = 'http://localhost:8025/api/v1';

/** A stay far enough out that no fixture booking is already sitting on it. */
function isoDate(daysAhead: number): string {
  const at = new Date();

  at.setUTCDate(at.getUTCDate() + daysAhead);

  return at.toISOString().slice(0, 10);
}

test.describe('the three apps, working together', () => {
  test.use({ storageState: STAFF_STATE });

  test('a booking reaches the partner by email and the console by log', async ({
    page,
    request,
  }) => {
    /* Mailpit is the local SMTP catcher. Absent, the send fails and the row records the reason. */
    const mailUp = await request
      .get(`${MAILPIT}/messages`)
      .then((r) => r.ok())
      .catch(() => false);

    test.skip(
      !mailUp,
      'No mail catcher on :8025 — run `docker run -d --name safra-mail -p 1025:1025 ' +
        '-p 8025:8025 axllent/mailpit`. Without it the send FAILS and this asserts nothing.',
    );

    // ── 1. What the customer app posts when somebody books ───────────────────
    const search = await request.get(
      `${API}/search?checkIn=${isoDate(210)}&checkOut=${isoDate(212)}&adults=2&limit=1`,
    );

    expect(search.ok(), 'search must answer before anything can be booked').toBe(true);

    const unitId = (await search.json()).items?.[0]?.unitId as string | undefined;

    expect(unitId, 'the testbed must hold one bookable unit').toBeTruthy();

    const stamp = Date.now();
    const created = await request.post(`${API}/bookings`, {
      data: {
        unitId,
        checkIn: isoDate(210),
        checkOut: isoDate(212),
        adults: 2,
        guest: {
          fullName: 'Cross App Guest',
          email: `cross-app-${stamp}@safra.test`,
          phone: '+963900000123',
        },
        idempotencyKey: `cross-app-${stamp}-0000`,
      },
    });

    expect(created.status(), await created.text()).toBe(201);

    const reference = (await created.json()).reference as string;

    expect(reference).toMatch(/^BKG-/);

    /*
      ── 2. Staff capture the payment, which is what tells the partner ─────────

      The partner is notified when the MONEY moves, not when the draft is written — §6.4 fines them
      for not answering inside a window that starts at payment. `capture-payment` is the staff-gated
      stand-in for the gateway webhook (ADR 0002), so this needs a staff bearer token: the console has
      no button for it, deliberately, because it is a webhook's job.

      This spec runs in the `signed-in` project, LAST, for the reason `playwright.config.ts` sets out
      at length — `POST /auth/login` is rate limited and a sign-in mid-suite starves the ones after
      it.
    */
    const signIn = await request.post(`${API}/auth/login`, {
      data: {
        email: EMAIL,
        password: PASSWORD,
        /* `freshCode` waits out a code with seconds left, which is the flake this avoids. */
        totpCode: await freshCode(),
      },
    });

    expect(signIn.status(), await signIn.text()).toBe(200);

    const token = (await signIn.json()).accessToken as string;

    const captured = await request.post(`${API}/bookings/${reference}/capture-payment`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(captured.status(), await captured.text()).toBe(200);
    expect((await captured.json()).status).toBe('pending_confirmation');

    // ── 3. The console can find it, by reference ─────────────────────────────
    await page.goto(`/bookings?q=${reference}`, { waitUntil: 'networkidle' });

    await expect(
      page.getByText(reference),
      'the console must be able to look a fresh booking up by its reference',
    ).toBeVisible();

    // ── 4. The partner was told, and the delivery log says so in Arabic ──────
    await page.goto('/comms', { waitUntil: 'networkidle' });

    const log = await page.locator('body').innerText();

    expect(
      log,
      'the delivery log must NAME the template, not print its key — the defect fixed 2026-08-20',
    ).not.toContain('booking.needs_action');

    expect(
      log,
      'a booking awaiting the partner is the notice the platform sends most',
    ).toContain('حجز بانتظار رد الشريك');

    // ── 5. And the mail actually left the building ───────────────────────────
    const inbox = await request.get(`${MAILPIT}/messages`);
    const caught = (await inbox.json()) as { messages?: { Subject: string }[] };

    expect(
      caught.messages ?? [],
      'a booking that notified nobody is the trap §6.4 fines a partner for',
    ).not.toHaveLength(0);
  });

  /**
   * Every notification the platform has sent is one the console can name.
   *
   * The unit-level guard for this lives in `audit-catalogue.integration.test.ts`; this is the same
   * property asserted through the SCREEN, because the render site and the catalogue were wrong
   * independently of each other — the catalogue was missing all four real templates AND the column
   * printed the raw key rather than looking it up.
   */
  test('the delivery log names every template it shows', async ({ page }) => {
    await page.goto('/comms', { waitUntil: 'networkidle' });

    const body = await page.locator('body').innerText();
    const rawKeys = body.match(/\b[a-z]+\.[a-z_]+\b/g) ?? [];

    expect(
      rawKeys.filter((k) => !k.endsWith('.test') && !k.includes('@')),
      'a dotted lowercase identifier on this screen is an untranslated key',
    ).toEqual([]);
  });
});
