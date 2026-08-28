import { expect, test, type Page } from '@playwright/test';

import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * «What is new since I last looked» — the badge, the tint, and the clearing.
 *
 * Bashar, 2026-08-27: a badge counting the new rows on a section, those rows marked when the page
 * opens, and both reset once he has moved on.
 *
 * ## Why this is a browser test
 *
 * `section-seen.integration.test.ts` holds the arithmetic — that «never looked» counts nothing,
 * that the mark is per section, that the count stops at the cap. None of that can see the part
 * that actually has to work: the mark is written by a CLIENT EFFECT after the page has rendered
 * from the old one, so the reader is shown what is new on the very visit that clears it. Get that
 * ordering wrong and the badge is either never shown or never cleared, and both look like a
 * working feature until somebody watches the sequence.
 */
test.describe('what is new since I last looked', () => {
  test.skip(MISSING_CREDENTIALS, SKIP_REASON);
  test.use({ storageState: STAFF_STATE });

  /**
   * Puts a genuinely NEW customer on the platform, so this file always has a batch to look at.
   *
   * ## Why the tests cannot just hope for one
   *
   * They did, and skipped. «New since I last looked» needs a row that arrived after this account's
   * last visit — and by the time this file runs, the specs before it have opened العملاء several
   * times and retired whatever batch existed. Three cases skipped inside `pnpm e2e` on 2026-08-28
   * while passing alone, which is the vacuous shape this suite's own history keeps warning about:
   * a skipped test reports coverage it does not have.
   *
   * So the batch is CREATED, through the platform's own public registration — a real customer
   * arriving the way real customers do, rather than a row written behind the console's back.
   */
  /**
   * Settles this account's mark on العملاء, then puts `howMany` genuinely new customers behind it.
   *
   * ## Why the mark is settled FIRST
   *
   * «Never looked» deliberately counts nothing — a new operator must not be greeted by a badge
   * counting every customer the platform has ever had — so a customer registered before this
   * account has ever opened العملاء is not new to it. One visit establishes the boundary; every row
   * created after it is the batch.
   */
  async function aFreshBatch(page: Page, howMany: number): Promise<void> {
    /*
      WAIT for the settling report, rather than sleeping on it.

      A fixed pause was wrong twice over: too short and the boundary is stamped after the customers
      are registered, so they are not new; late and the report lands on top of the next page's, with
      a frontier from a ten-row view that reaches far below the batch — which reads as «fully read»
      and empties the badge. Both produce a test that fails while the feature works.
    */
    const settled = page.waitForResponse(
      (response) =>
        response.url().includes('/api/me/seen') && response.request().method() === 'POST',
    );

    await page.goto('/customers?size=10');
    await page.waitForSelector('tbody tr');
    await settled;

    for (let index = 0; index < howMany; index += 1) await aCustomerArrives(page);
  }

  /**
   * Puts a genuinely NEW customer on the platform, through the platform's own registration.
   *
   * ## Why the tests cannot just hope for one
   *
   * They did, and skipped. «New since I last looked» needs a row that arrived after this account's
   * last visit, and by the time this file runs the specs before it have opened العملاء and retired
   * whatever batch existed. Three cases skipped inside `pnpm e2e` while passing alone — the vacuous
   * shape this suite's own history keeps warning about, where a skip reports coverage it lacks.
   *
   * ## And why it waits rather than failing
   *
   * `POST /auth/register` allows five a minute per IP. That is a live control against credential
   * stuffing and the suite is the thing that should bend, so a busy limiter is waited out rather
   * than treated as a broken fixture — the same judgement `partner.setup.ts` makes about sign-in.
   */
  async function aCustomerArrives(page: Page): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      /*
        `+96395…` — a real Syrian mobile prefix, not merely nine digits, and built from digits alone:
        slicing the tail of `unique` put its hyphen inside the number, which the schema refused with
        `validation.phone_format`.
      */
      const national = String(Math.floor(Math.random() * 1e7)).padStart(7, '0');

      /* The CUSTOMER app in full: this file's `baseURL` is the console, where that route is a 404. */
      const response = await page.request.post(
        'http://localhost:3000/ar/api/auth/register',
        {
          data: {
            email: `new-since-${unique}@safra.test`,
            password: 'Qawmiyya-9427-Halab',
            fullName: 'عميل جديد للاختبار',
            phone: `+96395${national}`,
            gender: 'undisclosed',
            preferredLocale: 'ar',
          },
        },
      );

      if (response.status() < 400) return;

      if (response.status() !== 429) {
        expect(
          response.status(),
          `a customer could not be registered. The server said: ${await response.text()}`,
        ).toBeLessThan(400);
      }

      /* Throttled: the window is a minute, so a dozen seconds is a fraction of it. */
      await page.waitForTimeout(12_000);
    }

    throw new Error('Registration stayed rate-limited; no batch could be made.');
  }

  /** This section's sidebar badge, as a number — zero when it is not rendered at all. */
  async function badge(page: Page, href: string): Promise<number> {
    const pill = page.locator(`.console-sidebar nav a[href="${href}"] span.rounded-full`);

    if ((await pill.count()) === 0) return 0;

    return Number(((await pill.textContent()) ?? '').replace(/[^\d]/g, ''));
  }

  /**
   * ── The whole journey, in one test ──────────────────────────────────────
   *
   * Both of Bashar's reports, and the retirement rule, walked end to end:
   *
   *  1. «when I go to the next page on the table, I do not see the new row marked and the badge
   *     number get removed» (2026-08-28) — paging must keep the tint and lower the badge by what
   *     was shown, not clear both.
   *  2. «when I change the rows number from 10 to 25, new rows are not marked anymore and the badge
   *     number gets hidden» — a page LARGER than the batch overshoots its end, and that is not a
   *     decision to be finished with the section.
   *  3. «after switching the page or logout reset the badge number and hide it» (2026-08-27) —
   *     leaving is what retires a batch.
   *
   * ## Why ONE test and not three
   *
   * Each needs a batch, and a batch needs registrations, and `POST /auth/register` allows five a
   * minute per IP against credential stuffing. Three tests spent that budget three times over and
   * failed with `request.too_many` — an error with no relationship to what any of them assert.
   * One journey needs one batch, and the steps are ordered anyway: you cannot page a batch you have
   * not been given, or retire one you have not read.
   */
  test('a batch is paged, resized, read out and retired', async ({ page }) => {
    /* Registration waits out a busy limiter, which can take longer than the default budget. */
    test.setTimeout(180_000);

    /* Three, so a one-row page leaves two still unread after the first view. */
    await aFreshBatch(page, 3);

    const pill = page.locator(
      '.console-sidebar nav a[href="/customers"] span.rounded-full',
    );
    const tinted = () => page.locator('tbody tr[data-new]').count();
    const badge = async (): Promise<number> =>
      (await pill.count()) === 0
        ? 0
        : Number(((await pill.textContent()) ?? '').replace(/[^\d]/g, ''));

    /** Goes somewhere and waits for that page's report to land, so the next step is not a race. */
    const visit = async (url: string): Promise<void> => {
      const reported = page.waitForResponse(
        (response) =>
          response.url().includes('/api/me/seen') &&
          response.request().method() === 'POST',
      );

      await page.goto(url);
      await page.waitForSelector('tbody tr');
      await reported;
    };

    /* ── 1. arrive on a ONE-row page ──────────────────────────────────────── */
    await page.goto('/customers?size=1');
    await page.waitForSelector('tbody tr');

    expect(await badge(), 'the batch is there to be read').toBeGreaterThanOrEqual(3);
    expect(await tinted(), 'and the row on screen is marked').toBe(1);

    /* ── 2. page two: the row still unread is still marked ───────────────── */
    await visit('/customers?size=1');
    await page.goto('/customers?size=1&page=2');
    await page.waitForSelector('tbody tr');

    expect(
      await tinted(),
      'a row not yet seen is marked on page two — Bashar, 2026-08-28',
    ).toBe(1);

    /* ── 3. back to page one: the row already SEEN is no longer marked ───── */
    await visit('/customers?size=1&page=2');
    await page.goto('/customers?size=1');
    await page.waitForSelector('tbody tr');

    expect(
      await tinted(),
      'a row that has been on screen stops being marked — Bashar, 2026-08-28',
    ).toBe(0);

    /* ── 4. a page far larger: the rows never seen are STILL marked ──────── */
    await page.goto('/customers?size=25');
    await page.waitForSelector('tbody tr');

    expect(
      await tinted(),
      'growing the page keeps the unseen rows marked — Bashar, 2026-08-28',
    ).toBeGreaterThanOrEqual(1);

    /* ── 5. read out, leave, return: nothing marked, no badge ────────────── */
    await visit('/customers?size=25');
    await page.goto('/wallet');
    await page.waitForLoadState('domcontentloaded');
    await page.goto('/customers?size=25');
    await page.waitForSelector('tbody tr');

    expect(await tinted(), 'once read and left behind, nothing is marked').toBe(0);
    expect(await badge(), 'and the badge is gone').toBe(0);
  });

  /**
   * الحجوزات keeps its SLA badge and takes the tint only (Bashar's choice, 2026-08-27).
   *
   * «بانتظار تأكيد الشريك» is work with a deadline, and replacing it with an unread count would
   * trade an operational signal for a convenience. Asserted because the two behaviours live one
   * line apart in the same file and the wrong one would look perfectly reasonable.
   */
  test('leaves الحجوزات counting its SLA queue, not its new rows', async ({ page }) => {
    await page.goto('/bookings');
    await page.waitForSelector('tbody tr');

    const sla = await badge(page, '/bookings');

    test.skip(sla === 0, 'Nothing is awaiting partner confirmation.');

    /* Visiting marks it seen; the badge must be unmoved, because it counts something else. */
    await page.goto('/wallet');
    await page.goto('/bookings');
    await page.waitForSelector('tbody tr');

    expect(
      await badge(page, '/bookings'),
      'the SLA count is not a «new rows» count and does not clear on a visit',
    ).toBe(sla);
  });

  /**
   * A capped badge says «99+», never a figure that stopped counting.
   *
   * The same rule the tables follow for «أكثر من ١٠٠٠٠ نتيجة». The first version of this capped
   * EVERY badge, which turned «١٠٢٦ حجزاً بانتظار تأكيد الشريك» into «+99» — an operational number
   * replaced by a shrug. So this asserts both halves: the unbounded badges may cap, and the
   * bounded queues must print their exact count however large.
   */
  test('caps only the badges that have no bound', async ({ page }) => {
    await page.goto('/customers');
    await page.waitForSelector('tbody tr');

    const sla = page.locator(
      '.console-sidebar nav a[href="/bookings"] span.rounded-full',
    );

    if ((await sla.count()) > 0) {
      const text = ((await sla.textContent()) ?? '').trim();

      expect(text, 'the SLA queue prints its exact count').not.toContain('+');
    }

    /* And where a capped badge IS shown, it is written as a cap rather than as a total. */
    for (const href of ['/customers', '/payments', '/wallet']) {
      const pill = page.locator(
        `.console-sidebar nav a[href="${href}"] span.rounded-full`,
      );

      if ((await pill.count()) === 0) continue;

      const text = ((await pill.textContent()) ?? '').trim();

      expect(
        /^\d+\+?$/.test(text),
        `«${text}» is a count or a capped count, and nothing else`,
      ).toBe(true);
    }
  });
});
