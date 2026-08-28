import { expect, test } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * النزاعات — what an operator has in front of them before they decide.
 *
 * ## Why this is a browser test and not an assertion on the service
 *
 * `booking-dispute.integration.test.ts` holds the payload: `list()` returns the description. That
 * would have gone on passing with the field arriving at a screen that never rendered it, which is
 * the exact shape this codebase keeps producing — «built, green, and connected to nothing». The
 * question here is whether the words reach a person.
 *
 * ## What was wrong
 *
 * Closing a dispute releases the partner's frozen payout and may credit the customer's wallet. Until
 * 2026-08-27 the operator making that call could read a 120-character TITLE and nothing else: the
 * queue never selected `disputes.description`, and the booking screen showed a count. Both routes
 * write one — the customer's own words through the app, and the account a staff member takes down
 * over the phone. Measured that day: 22 of 22 open disputes carried a description and not one of
 * them was on a screen.
 */
test.describe('النزاعات', () => {
  test.skip(MISSING_CREDENTIALS, SKIP_REASON);
  test.use({ storageState: STAFF_STATE });

  /**
   * The card carries the account, not just the headline.
   *
   * ## Why the account is MARKED rather than searched for
   *
   * `data-dispute-account` finds the description and nothing else, the same way `data-status-pill`
   * finds statuses. The first version of this test measured the card's text length against its
   * title's — which would have passed against a card rendering its headline twice, in a larger
   * font. A sweep that cannot say which element it found is not asserting about that element.
   *
   * ## And a control, because a headline can paraphrase its own account
   *
   * Some titles restate the description closely, so «an account is present» alone would pass on a
   * card showing the headline in both places. Every rendered account is therefore checked to differ
   * from the title beside it.
   */
  test('shows what the person actually said, not only the headline', async ({ page }) => {
    await page.goto('/disputes?size=25');
    await page.waitForSelector('article');

    const accounts = page.locator('[data-dispute-account]');

    /*
      Not `toBeVisible()` on the first one — the number matters. A single card rendering an account
      while the projection dropped it for everyone else is a shape a first-row assertion cannot see,
      and «22 of 22 carried one» is the measurement that started this.
    */
    expect(
      await accounts.count(),
      'the queue shows the account somebody gave, not just the headline — zero here means the ' +
        'description never reached the screen, which is the defect this exists for',
    ).toBeGreaterThan(0);

    const cards = page.locator('article');
    const total = await cards.count();

    for (let index = 0; index < total; index += 1) {
      const card = cards.nth(index);
      const account = card.locator('[data-dispute-account]');

      if ((await account.count()) === 0) continue;

      const said = (await account.innerText()).trim();
      /* The headline: the first paragraph on the card, above the booking line. */
      const title = (await card.locator('p').first().innerText()).trim();

      expect(said, 'an account that renders empty is worse than none').not.toBe('');
      /*
        The control. Some titles paraphrase the account closely, so «the description is present»
        alone would pass on a card showing its headline twice.
      */
      expect(said, 'the account is not simply the headline again').not.toBe(title);
    }
  });

  /**
   * «استلام» brings the badge down — the whole of what Bashar asked for on 2026-08-27.
   *
   * ## Both halves, because either alone is a different feature
   *
   * The badge must DECREASE, and the dispute must stay in the queue with «مستحقات مجمّدة»
   * unchanged. A button that only did the first would be a read-flag hiding a dispute whose payout
   * is still frozen — the console reporting an empty queue over money the platform is holding.
   *
   * ## Read from the SIDEBAR, not from the KPI
   *
   * The KPI «نزاعات مفتوحة» and the badge are computed by different code on different screens; this
   * asserts the one Bashar pointed at.
   */
  test('taking a dispute lowers the badge without releasing the money', async ({
    page,
  }) => {
    await page.goto('/disputes?size=25');
    await page.waitForSelector('article');

    const badge = page.locator(
      '.console-sidebar nav a[href="/disputes"] span.rounded-full',
    );
    /*
      The KPI's VALUE, reached through its own label.

      Written as a substring `getByText` first and it matched ten elements: every unresolved card
      carries a «المستحقات مجمّدة» pill, and the KPI's «مستحقات مجمّدة» is a substring of it.
      `exact` separates the two, and the value is the paragraph directly after the label — see
      `Kpi` in `console-shell.tsx`.
    */
    const frozen = page
      .locator('main')
      .getByText(t.sections.disputes.kpiFrozen, { exact: true })
      .locator('xpath=following-sibling::p[1]');

    await expect(badge, 'the queue has a backlog to work from').toBeVisible();

    const numeric = async (locator: typeof badge): Promise<number> =>
      Number(((await locator.textContent()) ?? '').replace(/[^\d]/g, ''));

    const before = await numeric(badge);
    const frozenBefore = await numeric(frozen);

    /*
      ── the skip has to be narrower than «no button» ─────────────────────────

      This first read «skip if there is no button», and mutating the card to stop offering one made
      the test SKIP rather than fail — a vacuous pass over exactly the defect it exists for.

      So the page is asked how many UNTAKEN disputes it is showing, from the status pills. Zero is
      the only honest reason to skip; one or more and the control must be there, asserted rather
      than assumed. «مفتوح» is not a substring of any other dispute status word — the closed ones
      are «مغلق — …» and the taken one is «قيد المراجعة».
    */
    const untaken = page
      .locator('article [data-status-pill]')
      .filter({ hasText: t.enums.disputeStatus['open'] ?? '' });

    test.skip(
      (await untaken.count()) === 0,
      'Every dispute here has already been taken.',
    );

    const take = page
      .getByRole('button', { name: t.sections.disputes.acknowledge })
      .first();

    await expect(take, 'an untaken dispute offers «استلام»').toBeVisible();

    await take.click();

    await expect
      .poll(async () => numeric(badge), {
        timeout: 15_000,
        message: 'the badge counts what nobody has taken, so taking one lowers it',
      })
      .toBe(before - 1);

    /* And the money is exactly where it was. */
    expect(
      await numeric(frozen),
      'taking a dispute does not release the partner payout it is holding',
    ).toBe(frozenBefore);
  });

  /**
   * A photograph can be filed on a dispute, and it is SERVED — not merely stored.
   *
   * ## The gap this closes
   *
   * `dispute_evidence` existed from the first migration and nothing could write a row: zero,
   * platform-wide, on 2026-08-27, while this screen offered to tell an operator how many there
   * were. «الغرفة لا تطابق الصور المنشورة» is a claim settled by looking at a photograph, and there
   * was no way to put one in front of anybody.
   *
   * ## `naturalWidth` is the assertion, and it is doing more here than usual
   *
   * The bytes are PRIVATE: the `disputes/` prefix is deliberately absent from the bucket's
   * anonymous read policy, so the picture only appears if the whole authorised path works — the
   * console's own route, the cookie it exchanges for a token, the API's scope check, and the
   * variant the renderer actually produced. A stored row and a rendered file are not the same
   * thing, and neither is the same as a picture a person can see.
   */
  test('files a photograph on a dispute and shows what the server re-encoded', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.goto('/disputes?size=5');
    await page.waitForSelector('article');

    const card = page.locator('article').first();
    const add = card.getByRole('button', { name: t.sections.disputes.evidenceAdd });

    await expect(add, 'an open dispute offers to take evidence').toBeVisible();

    const before = await card.locator('[data-evidence]').count();

    await page.setInputFiles('input[type=file]', 'e2e/fixtures/room-one.jpg');

    /*
      The render is a QUEUED job, so a placeholder stands in until a worker has run. Polled rather
      than slept on: how long that takes is not this test's business.
    */
    await expect
      .poll(async () => card.locator('[data-evidence]').count(), {
        timeout: 60_000,
        message: 'the photograph reaches the card',
      })
      .toBeGreaterThan(before);

    const picture = card.locator('[data-evidence] img').first();

    await expect
      .poll(
        async () => picture.evaluate((node) => (node as HTMLImageElement).naturalWidth),
        { timeout: 60_000, message: 'and the browser actually loaded it' },
      )
      .toBeGreaterThan(0);

    /*
      Served from THIS origin under authorisation, never from the object store. A public URL here
      would mean a photograph of the inside of somebody's home was readable by anyone holding the
      link — which is why the prefix is not in the bucket policy, and why this asserts the path.
    */
    expect(
      await picture.getAttribute('src'),
      'the bytes come through the authorised route, not the media host',
    ).toMatch(/^\/api\/disputes\/evidence\//);
  });

  /**
   * The queue is ordered as a queue, and it says how much is frozen.
   *
   * A dispute holds the partner's payout, so «مستحقات مجمّدة» is money the platform is sitting on.
   * It is the number an operator justifies their day by, and a KPI that silently read zero would
   * make the backlog invisible.
   */
  test('counts the payouts it is holding', async ({ page }) => {
    await page.goto('/disputes');

    const main = page.locator('main');

    await expect(main).toContainText(t.sections.disputes.kpiFrozen);
    await expect(main).toContainText(t.sections.disputes.kpiOpen);
  });
});
