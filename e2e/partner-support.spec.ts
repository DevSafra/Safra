import { expect, test } from '@playwright/test';

import { partnerAr as t } from '../packages/i18n/src/partner.js';
import { PARTNER_BASE as BASE, PARTNER_STATE } from './partner-session.js';
import { STAFF_STATE } from './staff.js';
import { adminAr } from '../packages/i18n/src/admin.js';

/**
 * الدعم, partner side (Bashar, 2026-08-12).
 *
 * ## What a browser adds
 *
 * `support.integration.test.ts` proves the scoping, the redaction and the refusals against a real
 * database. What it cannot see is whether the SCREEN works — and the support pages are a form, a proxy
 * and two server components deep, where a failure renders as an empty page with a 200.
 *
 * ## It costs no sign-in
 *
 * The partner project replays the session `partner.setup.ts` captured, so this spec adds nothing to the
 * login budget that shapes the rest of the suite — unlike the customer side, whose support assertions
 * ride along inside `customer-gifts.spec.ts` for exactly that reason.
 *
 * ## It leaves a ticket behind, deliberately
 *
 * Messages are append-only by trigger, so a spec cannot tidy up after itself here. It opens a real ticket
 * every run, which is the only way to keep testing the OPEN path — a spec that reused an existing thread
 * would stop exercising it after the first run. `db:testbed` clears them, which is what bounds the count.
 */
test.use({ baseURL: BASE, storageState: PARTNER_STATE });

const ENOUGH = 'مستحقاتي لم تُحدَّث هذا الشهر ولم يردّ أحد على رسالتي.';

/** The console, where staff answer. Its own origin, so its own base URL. */
const ADMIN = process.env['ADMIN_URL'] ?? 'http://localhost:3001';

test.describe('الدعم', () => {
  test('opens a request, masks a phone number, and replies', async ({
    page,
    browser,
  }) => {
    await page.goto('/support');

    /* The destination exists in the sidebar, not only as a URL. */
    await expect(
      page.getByRole('link', { name: t.nav.supportPage, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: t.support.openTitle })).toBeVisible();

    /*
      A phone number goes in on purpose. Contact details are redacted on the way IN and the original is
      never kept, so this is the assertion that the rule reaches the screen a partner actually uses.
    */
    await page.locator('textarea[name=body]').fill(`${ENOUGH} اتصلوا بي على 0955123456.`);

    /*
      `form:has(textarea)`, not the last submit on the page.

      The sidebar's sign-out is itself a form submit button, so a looser selector signs the partner out —
      after which the reply does nothing and every later assertion fails for an unrelated reason. That
      cost a debugging cycle when this was first written.
    */
    await page.locator('form:has(textarea) button[type=submit]').click();
    await page.waitForURL(/\/support\/CNV-/, { timeout: 20_000 });

    const reference = (page.url().split('/').pop() ?? '').trim();

    expect(reference).toMatch(/^CNV-\d+$/);

    const thread = page.locator('ol');

    await expect(thread).not.toContainText('0955123456');
    /* And the masking is announced, or the sender waits for a call that cannot come. */
    await expect(thread).toContainText('حُجبت');

    // ── A reply lands in the same thread ──
    const before = await page.locator('ol li').count();

    await page.locator('textarea[name=body]').fill('هل من تحديث بشأن هذا الطلب؟');
    await page.locator('form:has(textarea) button[type=submit]').click();

    await expect(page.locator('ol li')).toHaveCount(before + 1, { timeout: 20_000 });

    // ── It is listed ──
    await page.goto('/support');
    await expect(page.locator('a[href^="/support/CNV-"]').first()).toBeVisible();

    /*
      A reference that is not this partner's is a 404, indistinguishable from one that does not exist.
      `CNV-` references are sequential, so any difference would let one partner count another's requests.
    */
    const foreign = await page.goto('/support/CNV-000001', {
      waitUntil: 'domcontentloaded',
    });

    expect(foreign?.status()).toBe(404);

    /*
      ── And staff can actually answer it ──

      The half of "manage everything" that nothing asserted until now. A ticket is a conversation with no
      other subject, so it should appear in the console's existing inbox — and the scope filter there keys
      on `coalesce(booking.city, partner.city)`, which is NULL for a ticket. A NULL never matches an
      `IN (…)` list, so before that filter was widened every ticket was invisible to a city-scoped
      operator while looking present to a super admin. This is the assertion that would have caught it.

      A second CONTEXT rather than a second spec: the ticket has to exist first, and ordering between spec
      files is not something to depend on. `STAFF_STATE` is the session `auth.setup.ts` already captured,
      so this costs nothing from the sign-in budget either.
    */
    const staffContext = await browser.newContext({ storageState: STAFF_STATE });
    const staffPage = await staffContext.newPage();

    try {
      await staffPage.goto(`${ADMIN}/messages?q=${encodeURIComponent(reference)}`, {
        waitUntil: 'domcontentloaded',
      });

      /*
        Asserted on the LINK, not on the text.

        The inbox prints the SUBJECT's reference — for a partner ticket that is the partner's own, not the
        conversation's — so searching for `CNV-…` and expecting to read it back finds nothing even when the
        row is right there. The href is what carries the thread's identity.
      */
      const row = staffPage.locator(`a[href*="${reference}"]`).first();

      await expect(row, 'the ticket must reach the console inbox').toBeVisible();

      /* Open the thread and answer it. */
      await row.click();
      await staffPage.waitForLoadState('domcontentloaded');

      const answer = 'تم التواصل مع المالية بشأن مستحقاتك.';

      await staffPage.locator('textarea').first().fill(answer);
      await staffPage
        .getByRole('button', { name: adminAr.sections.messages.reply })
        .click();

      /*
        Scoped to the thread LIST, not to the page.

        `getByText(answer)` anywhere on the page also matches the textarea the answer was just typed
        into, so the assertion passed whether or not the reply was ever posted — and the failure then
        surfaced further down, as the partner not seeing a message the staff side had "confirmed".
        Asserting inside the `<ul>` the console renders its messages into is what makes this a check
        that the reply LANDED.
      */
      await expect(staffPage.locator('ul').getByText(answer).first()).toBeVisible({
        timeout: 20_000,
      });

      /* And the partner sees it — the whole point of the thread being shared. */
      await page.goto(`/support/${reference}`, { waitUntil: 'domcontentloaded' });
      /* 20s, like its sibling above: a staff reply now enqueues a notification before it answers. */
      await expect(page.locator('ol')).toContainText(answer, { timeout: 20_000 });
    } finally {
      await staffContext.close();
    }

    /*
      ── The asker ends it themselves ──

      The gap this closes: only staff could close a thread, so a problem that resolved itself sat in the
      console's queue for ever. Asserted LAST, because closing is final — `reply` refuses a closed thread
      — so every assertion above has to happen while it is still open.

      `form:has(button)` scoped by the button's own name rather than a positional selector, for the same
      reason the reply uses `form:has(textarea)`: the sidebar's sign-out is also a submit button.
    */
    await page.goto(`/support/${reference}`, { waitUntil: 'domcontentloaded' });

    const close = page.getByRole('button', { name: t.support.closeLabel });

    await expect(close, 'the asker needs a way to end their own request').toBeVisible();
    await close.click();

    /* The badge flips, and the reply box is gone — a closed thread is read-only. */
    await expect(page.getByText(t.support.closedLabel).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('textarea[name=body]')).toHaveCount(0);
    await expect(page.getByText(t.support.closedNote)).toBeVisible();

    /* And the history survives: closing ends the thread, it does not hide it. */
    await expect(page.locator('ol li').first()).toBeVisible();

    // ── No page scrolls sideways ──
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/support', { waitUntil: 'domcontentloaded' });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(overflow, `/support scrolls sideways at ${width}px`).toBeLessThanOrEqual(0);
    }
  });

  /**
   * ── The console can end a thread, and الرسائل says how many are waiting ──
   *
   * The two remaining halves of the الرسائل review (2026-08-28). `closed_at` had exactly one writer
   * before this — `SupportService.close`, which is asker-only — so a request answered on the phone,
   * or opened twice, stayed in the console's queue for ever. The badge beside الرسائل counts open
   * threads with something unread, which is the number an agent works down; until now they could
   * not work it down.
   *
   * ## Its own ticket
   *
   * Closing is final, and the test above ends with the ASKER closing theirs. Two closes cannot share
   * one thread, so this opens its own — the same reason that test opens one rather than reusing an
   * existing thread.
   */
  test('ends a thread from the console, and the partner is told', async ({
    page,
    browser,
  }) => {
    await page.goto('/support');
    await page
      .locator('textarea[name=body]')
      .fill('سؤال عن موعد التحويل الشهري، ولا حاجة لمتابعة بعد الرد.');
    await page.locator('form:has(textarea) button[type=submit]').click();
    await page.waitForURL(/\/support\/CNV-/, { timeout: 20_000 });

    const reference = (page.url().split('/').pop() ?? '').trim();

    expect(reference).toMatch(/^CNV-\d+$/);

    const staffContext = await browser.newContext({ storageState: STAFF_STATE });
    const staffPage = await staffContext.newPage();

    try {
      await staffPage.goto(`${ADMIN}/messages/${reference}`, {
        waitUntil: 'domcontentloaded',
      });

      /*
        The badge, located the way الشركاء and النزاعات locate theirs — the span inside the SIDEBAR's
        own nav link. By role and name it collides with `BackLink`, whose accessible name is «الرجوع
        إلى الرسائل» and which matched first.

        Something unread exists by construction: this test opened a ticket a moment ago. A sidebar
        with no badge here means the counter never reached it.
      */
      await expect(
        staffPage.locator('.console-sidebar nav a[href="/messages"] span.rounded-full'),
        'الرسائل must carry the unread count',
      ).toBeVisible();

      const close = staffPage.getByRole('button', {
        name: adminAr.sections.messages.closeThread,
      });

      await expect(close, 'an open thread offers the control').toBeVisible();
      await close.click();

      /*
        The notice REPLACES the reply box. A closed thread's reply endpoint refuses everything, so a
        box left sitting there is a control that cannot work — «why can I not type» is the question
        a greyed-out one asks and does not answer.
      */
      await expect(
        staffPage.getByText(adminAr.sections.messages.closedNotice),
      ).toBeVisible({ timeout: 20_000 });
      await expect(staffPage.locator('textarea')).toHaveCount(0);
      await expect(
        staffPage.getByRole('button', { name: adminAr.sections.messages.closeThread }),
      ).toHaveCount(0);

      /* And the history survives: ending a thread is not hiding it. */
      await expect(staffPage.locator('ul li').first()).toBeVisible();
    } finally {
      await staffContext.close();
    }

    /* The person who was waiting is told, on the page they read it in. */
    await page.goto(`/support/${reference}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(t.support.closedNote)).toBeVisible();
    await expect(page.locator('textarea[name=body]')).toHaveCount(0);
  });
});
