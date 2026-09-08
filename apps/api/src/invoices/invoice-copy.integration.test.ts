import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';
import { INVOICE_LINE_KEYS } from '@safra/contracts';
import { LOCALES, WEB_CATALOGUES, statusWords, type StatusVocabulary } from '@safra/i18n';

/**
 * Every status and every line a receipt can render has a word in every language.
 *
 * ## Why this test is in the API and not in the i18n package
 *
 * The authority on which statuses exist is the DATABASE enum, and only this app can reach it.
 * `@safra/i18n` depends on `@safra/contracts` alone, so a test written there would have to hard-code
 * the list of statuses — and a hard-coded copy of an enum is the exact thing that goes stale silently.
 * Read from `pg_enum`, this fails the build the day somebody adds a payment status.
 *
 * ## Why it matters more here than on most screens
 *
 * An unlabelled status elsewhere is an untranslated word. On a receipt it is a missing-message
 * placeholder in the middle of a financial document somebody may forward to an accountant.
 *
 * The dynamic look-ups this protects are `dynamicMessage(t, 'status.…')`,
 * `dynamicMessage(t, 'paymentStatus.…')`, `dynamicMessage(tm, payment.method)` and
 * `t('invoiceLines.…')` on the الفواتير screens.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** The `account` block of a web catalogue, indexable by a runtime key. */
type Block = Record<string, unknown>;

function nested(locale: (typeof LOCALES)[number], path: readonly string[]): Block {
  let cursor: unknown = WEB_CATALOGUES[locale];

  for (const part of path) {
    cursor = (cursor as Block)[part];
  }

  return cursor as Block;
}

describeIfDb('receipt copy covers every enum it renders', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;

  beforeAll(async () => {
    await harness.begin();
    db = harness.db;
  });

  afterAll(async () => {
    await harness.rollback();
    await harness.close();
  });

  /** The live values of a PostgreSQL enum, in declaration order. */
  async function enumValues(name: string): Promise<string[]> {
    const found = await db.execute<{ enumlabel: string }>(sql`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = ${name}
      ORDER BY e.enumsortorder`);

    return found.rows.map((row) => row.enumlabel);
  }

  it('finds the enums it is asserting about', async () => {
    /* A typo'd type name would make every assertion below pass over an empty list. */
    await expect(enumValues('booking_status')).resolves.not.toHaveLength(0);
  });

  /**
   * Every value of every state enum has a canonical word, in every language.
   *
   * ## Why this widened, and why it reads the canonical catalogue
   *
   * It checked two vocabularies against the customer app's OWN copy of them. Those copies are gone
   * (Bashar, 2026-09-08): one word per state now lives in `packages/i18n/src/statuses.ts` and all
   * three apps read it, because 22 of the 58 states they shared were named differently by two of
   * them. Pointing this at the canonical catalogue keeps what the test was for — the database is
   * the authority on which states exist — and extends it to every vocabulary backed by an enum,
   * which is the same class of gap one table wider.
   *
   * `statuses.test.ts` proves the catalogue is internally complete and that every app resolves it.
   * Only THIS test can say whether it covers what the database can actually hold, because only
   * this app can read `pg_enum`. A value added to an enum and not to the catalogue reads as its
   * own identifier on a receipt — a raw `pending_confirmation` in a financial document.
   */
  const ENUM_VOCABULARIES: readonly (readonly [string, StatusVocabulary])[] = [
    ['booking_status', 'bookingStatus'],
    ['payment_status', 'paymentStatus'],
    ['dispute_status', 'disputeStatus'],
    ['dispute_kind', 'disputeKind'],
    ['gift_card_status', 'giftCardStatus'],
    ['payout_status', 'payoutStatus'],
    ['payout_account_status', 'payoutAccountStatus'],
    ['property_status', 'propertyStatus'],
    ['violation_kind', 'violationKind'],
    ['violation_stage', 'violationStage'],
  ];

  for (const [enumName, vocabulary] of ENUM_VOCABULARIES) {
    it.each([...LOCALES])(`%s names every ${enumName}`, async (locale) => {
      const values = await enumValues(enumName);
      const words = statusWords(vocabulary, locale);

      expect(values, `${enumName} has no values — check the type name`).not.toHaveLength(
        0,
      );
      expect(
        values.filter((value) => typeof words[value] !== 'string'),
        `Add these to ${vocabulary} in packages/i18n/src/statuses.ts, in all three languages.`,
      ).toStrictEqual([]);
    });
  }

  /**
   * A payment method needs a word too.
   *
   * `paymentMethods` is shared with the checkout, which is why three of these were missing when the
   * receipt started rendering them: the checkout only ever offers the methods a customer can CHOOSE,
   * and a receipt reports the one that was used — including `wallet` and `gift_card`, which the
   * checkout applies rather than offers.
   */
  it.each([...LOCALES])('%s labels every payment method', async (locale) => {
    const methods = await enumValues('payment_method');
    const labels = nested(locale, ['paymentMethods']);

    expect(methods.filter((method) => typeof labels[method] !== 'string')).toStrictEqual(
      [],
    );
  });

  it.each([...LOCALES])('%s labels every receipt line', (locale) => {
    const labels = nested(locale, ['account', 'invoiceLines']);

    expect(
      INVOICE_LINE_KEYS.filter((key) => typeof labels[key] !== 'string'),
    ).toStrictEqual([]);
  });
});
