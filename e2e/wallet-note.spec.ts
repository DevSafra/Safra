import { expect, test } from '@playwright/test';

import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * «السبب» on المحفظة reads Arabic (Bashar, 2026-08-26).
 *
 * The column printed `wallet_transactions.note` raw, and the platform wrote English prose into it
 * from eight services — «Partner did not respond within the confirmation window.» on 9,083 rows of
 * a console that is Arabic-only. The services write a CODE now, the console translates it, and the
 * legacy sentences are mapped because the table is append-only and cannot be rewritten.
 *
 * Asserted in a BROWSER because that is where the defect was: `pnpm verify` was green the whole
 * time it was there.
 */
test.describe('the wallet ledger', () => {
  test.skip(MISSING_CREDENTIALS, SKIP_REASON);
  test.use({ storageState: STAFF_STATE });

  /**
   * Reached by SEARCHING for the legacy sentence, not by reading page one.
   *
   * The first version asserted over whatever the newest 25 rows happened to be, and passed with
   * the fix reverted — the 9,083 rows carrying «Partner did not respond within the confirmation
   * window.» are old, and page one is recent test fixtures. A test that cannot reach the data it
   * protects reports coverage it does not have.
   *
   * The search matches the STORED note, so it still finds these rows once the console translates
   * them — which is exactly what makes it a usable probe: it selects by what the database holds
   * and asserts on what the screen says.
   */
  test('translates the sentences written before the codes existed', async ({ page }) => {
    await page.goto('/wallet?size=25&q=' + encodeURIComponent('Partner did not respond'));

    const rows = page.locator('tbody tr');

    expect(
      await rows.count(),
      'the probe found no legacy rows, so this test proves nothing',
    ).toBeGreaterThan(0);

    /* Column five is «السبب» — see the wallet page's own column order. */
    const reasons = (await page.locator('tbody tr td:nth-child(5)').allInnerTexts()).map(
      (r) => r.trim(),
    );

    expect(
      reasons.filter((reason) => reason.includes('Partner did not respond')),
      'the legacy sentence is still reaching the screen in English',
    ).toStrictEqual([]);

    /* And what it reads INSTEAD — an absence proves nothing on its own. */
    expect(reasons[0]).toContain('لم يردّ الشريك');
  });

  test('never prints the platform’s own words in English', async ({ page }) => {
    await page.goto('/wallet?size=25');

    const rows = page.locator('tbody tr');

    expect(await rows.count(), 'the ledger has rows to read').toBeGreaterThan(0);

    /* Column five is «السبب» — see the wallet page's own column order. */
    const reasons = (await page.locator('tbody tr td:nth-child(5)').allInnerTexts()).map(
      (r) => r.trim(),
    );

    /*
      A raw code is the general failure: `label` does not prettify, so a `wallet.note.*` with no
      catalogue entry reaches the screen exactly as stored. This catches every note the platform
      writes, including ones nobody has added yet.
    */
    expect(
      reasons.filter((reason) => reason.startsWith('wallet.note.')),
      'These are codes with no Arabic name. Add them to `enums.walletNote` in messages/admin/ar.ts.',
    ).toStrictEqual([]);

    /*
      And the sentences written before the codes existed. `wallet_transactions` is append-only, so
      those rows can never be rewritten — the catalogue maps them, and this proves the map still
      reaches them. Named explicitly because that is what a legacy map can be held to.

      A staff member's OWN note is not checked and must not be: `input.note` on a manual adjustment
      is a person's words, in whatever language they typed, and translating it is not the console's
      business.
    */
    const LEGACY = [
      'Partner did not respond within the confirmation window.',
      'Balance moved to the account that claimed this guest profile.',
      'Balance carried over from a guest booking made with this address.',
    ];

    for (const sentence of LEGACY) {
      expect(
        reasons,
        `«${sentence}» is still reaching the screen untranslated`,
      ).not.toContain(sentence);
    }
  });

  /**
   * المحفظة was the one registry a reader could not click out of.
   *
   * Seven others link their rows into a detail screen; this one printed a customer reference and a
   * booking reference at the reader and left them to search another registry — which is the exact
   * complaint that produced the customer record in the first place.
   *
   * Asserted as a ROUND TRIP rather than as an href. A link that opens the right screen and comes
   * back to the wrong one is the failure this console's `from` allow-list exists to prevent, and it
   * is silent: the fallback is a valid link to a real page.
   */
  test('opens a customer from a movement and comes back', async ({ page }) => {
    /*
      SEARCHED for, not read off page one.

      Not every row can link: a movement outlives the profile it belongs to, and a deleted one has
      no record to open. Page one of المحفظة is recent fixtures whose customers are all soft-deleted,
      so a test reading it SKIPPED — which is a pass that proves nothing, and this suite has already
      produced one of those today. The search finds a live customer with real movements.
    */
    await page.goto('/wallet?size=10&q=' + encodeURIComponent('Payments Guest'));

    const customerLink = page.locator('tbody tr a[href^="/customers/CUS-"]').first();

    expect(
      await customerLink.count(),
      'the probe found no linkable row, so this test proves nothing',
    ).toBe(1);

    const reference = (await customerLink.getAttribute('href'))
      ?.split('/')[2]
      ?.split('?')[0];

    await customerLink.click();
    await page.waitForURL(/\/customers\/CUS-/);

    /* The right customer, not merely a customer. */
    await expect(page.locator('main')).toContainText(reference ?? '—');

    /* And back — to المحفظة, not to العملاء, which is what a discarded `from` would give. */
    await page.locator('a[href^="/wallet"]').first().click();
    await page.waitForURL(/\/wallet/);

    expect(page.url()).toContain('/wallet');
  });

  /** The other reference on the row, and the same trip. */
  test('opens the booking a movement belongs to', async ({ page }) => {
    /* Same probe, for the same reason — page one carries no booking-linked movement. */
    await page.goto('/wallet?size=25&q=' + encodeURIComponent('Payments Guest'));

    const bookingLink = page.locator('tbody tr a[href^="/bookings/BKG-"]').first();

    expect(
      await bookingLink.count(),
      'the probe found no booking-linked row, so this test proves nothing',
    ).toBe(1);

    await bookingLink.click();
    await page.waitForURL(/\/bookings\/BKG-/);

    await page.locator('a[href^="/wallet"]').first().click();
    await page.waitForURL(/\/wallet/);

    expect(page.url()).toContain('/wallet');
  });
});
