import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LOCALES, WEB_CATALOGUES, adminMessages } from '@safra/i18n';
import { createDatabase, type Database } from '@safra/db';

/**
 * Every reason a wallet balance can move has a word — for the customer AND for the operator.
 *
 * ## The defect this closes
 *
 * محفظتي printed `profile_claim` to the customer. The reason exists because balance moves from a
 * guest booking onto the account that claims it once the email is verified (§4) — a good thing to
 * be told, in a sentence — and the customer's catalogue had five of the six reasons, so the sixth
 * fell through to the raw code. The console had «ضم حساب ضيف» for it all along.
 *
 * Found by sweeping the rendered screens for identifier-shaped text on 2026-09-08, on Bashar's
 * instruction that no reader should meet a technical code where a human-readable value belongs.
 * No test could have caught it: the customer's map was complete to the data somebody had looked at.
 *
 * ## Read from `pg_enum`, and checked for BOTH readers
 *
 * The database is the authority on which reasons exist, and only this app can reach it — the same
 * argument `invoice-copy.integration.test.ts` makes. Both catalogues are checked because a wallet
 * movement is read on محفظتي by the person whose money it is and on المحفظة by the operator who
 * has to explain it, and either one falling through is the same defect.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('wallet reasons are readable', () => {
  let db: Database;

  beforeAll(() => {
    db = createDatabase(DATABASE_URL ?? '', 2);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  /** The live values of the reason enum, in declaration order. */
  async function reasons(): Promise<string[]> {
    const found = await db.execute<{ enumlabel: string }>(sql`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'wallet_txn_reason'
      ORDER BY e.enumsortorder
    `);

    return found.rows.map((row) => row.enumlabel);
  }

  it('finds the enum it is asserting about', async () => {
    /* A renamed type would make every assertion below pass over an empty list. */
    await expect(reasons()).resolves.not.toHaveLength(0);
  });

  it.each([...LOCALES])(
    '%s gives the customer a sentence for every reason',
    async (locale) => {
      const words = (
        WEB_CATALOGUES[locale].account as unknown as {
          reason: Record<string, string>;
        }
      ).reason;

      expect(
        (await reasons()).filter((reason) => typeof words[reason] !== 'string'),
        'These reasons can appear on محفظتي and have no sentence, so the customer reads the code. ' +
          'Add them to `account.reason` in messages/web/*.json.',
      ).toStrictEqual([]);
    },
  );

  it('gives the operator a word for every reason too', async () => {
    const words = adminMessages('ar').enums.walletReason;

    expect(
      (await reasons()).filter((reason) => typeof words[reason] !== 'string'),
      'Add them to `enums.walletReason` in messages/admin/ar.ts.',
    ).toStrictEqual([]);
  });
});
