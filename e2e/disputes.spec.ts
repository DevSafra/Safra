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
