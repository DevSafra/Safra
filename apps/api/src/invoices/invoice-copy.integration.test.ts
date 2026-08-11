import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';
import { INVOICE_LINE_KEYS } from '@safra/contracts';
import { LOCALES, WEB_CATALOGUES } from '@safra/i18n';

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

  it.each([...LOCALES])('%s labels every booking status', async (locale) => {
    const statuses = await enumValues('booking_status');
    const labels = nested(locale, ['account', 'status']);

    expect(statuses.filter((status) => typeof labels[status] !== 'string')).toStrictEqual(
      [],
    );
  });

  it.each([...LOCALES])('%s labels every payment status', async (locale) => {
    const statuses = await enumValues('payment_status');
    const labels = nested(locale, ['account', 'paymentStatus']);

    expect(statuses.filter((status) => typeof labels[status] !== 'string')).toStrictEqual(
      [],
    );
  });

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
