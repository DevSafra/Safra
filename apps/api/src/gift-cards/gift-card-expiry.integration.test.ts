import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { GiftCardExpiryService } from './gift-card-expiry.service.js';
import { unlockedJobRuns } from '../common/jobs/job-run.testing.js';
import { PromotionsService } from '../admin/promotions.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { FxRateService } from '../fx/fx-rate.service.js';

/**
 * `expired` was a gift card status nothing could ever write.
 *
 * `gift_card_status` has four values and three had writers — `active` on creation, `used` on
 * redemption, `cancelled` by hand. A card past `expires_at` kept `status = 'active'` for ever, and
 * there was no scheduled job for gift cards at all.
 *
 * **No money was ever at risk**, which is the first thing to establish rather than the last:
 * `redeem()` compares `expires_at` against `now()` inside the transaction, after the row lock, so
 * an expired card is refused whatever its column says. What the column cost was TRUTH — the screen
 * painted «نشطة» on a card that could not be spent, and any figure filtering `status = 'active'`
 * counted it as live liability.
 *
 * ## Two halves, and each is tested against what the other cannot do
 *
 * The SWEEP makes the column right, for every reader that queries it without knowing to
 * compensate — a report, an export, a service nobody has written yet. The LIST computes the
 * effective status, so the hour between expiry and the next sweep is not a window where the screen
 * disagrees with redemption. Neither replaces the other.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a gift card past its expiry', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const expiry = new GiftCardExpiryService(
    db,
    unlockedJobRuns(db),
    new LedgerService(db),
    new FxRateService(db, {} as never),
  );
  const promotions = new PromotionsService(db);

  beforeEach(() => harness.begin());
  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /**
   * A card whose expiry is `hours` from now — negative for the past, `null` for no expiry at all.
   *
   * An OFFSET rather than an expression, because a `now() - interval '1 hour'` string handed to a
   * `timestamptz` placeholder is bound as a literal and Postgres refuses it. The arithmetic belongs
   * in the statement; only the number crosses as a parameter.
   */
  async function card(
    hours: number | null,
    status = 'active',
    options: { remaining?: string; bought?: boolean; currency?: string } = {},
  ): Promise<string> {
    const made = await db.execute<{ reference: string }>(sql`
      INSERT INTO gift_cards
        (code_hash, code_last4, original_amount, remaining_amount, currency_id, status, expires_at,
         purchased_by_customer_id)
      VALUES (
        'hash-' || gen_random_uuid(), '4242', '100.00', ${options.remaining ?? '100.00'},
        (SELECT id FROM currencies WHERE code = ${options.currency ?? 'USD'}),
        ${status}::gift_card_status,
        CASE WHEN ${hours}::int IS NULL THEN NULL
             ELSE now() + (${hours}::int * interval '1 hour') END,
        ${options.bought ? sql`(SELECT id FROM customer_profiles ORDER BY created_at LIMIT 1)` : sql`NULL`}
      )
      RETURNING reference
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no card.');

    return row.reference;
  }

  const statusOf = async (reference: string): Promise<string> => {
    const rows = await db.execute<{ status: string }>(sql`
      SELECT status::text AS status FROM gift_cards WHERE reference = ${reference}
    `);

    return rows.rows[0]?.status ?? '';
  };

  /**
   * The assertion the sweep exists for.
   *
   * Watched to fail with the job removed: the card stays `active` for ever, which is the state
   * every gift card with a past expiry was in before this.
   */
  it('is retired by the sweep', async () => {
    const due = await card(-1);

    await expiry.sweep();

    expect(await statusOf(due)).toBe('expired');
  });

  /**
   * The controls — three cards the sweep must NOT touch, each for a different reason.
   *
   * Without these, a sweep that simply set every card to `expired` would pass the test above.
   */
  it('leaves alone a card that has not expired, has no expiry, or is already spent', async () => {
    const later = await card(24 * 30);
    const never = await card(null);
    const spent = await card(-1, 'used');

    await expiry.sweep();

    expect(await statusOf(later), 'not due yet').toBe('active');
    expect(await statusOf(never), 'a card with no expiry never expires').toBe('active');
    /* And a spent card keeps saying it was SPENT, which is the more informative fact. */
    expect(await statusOf(spent), 'already used').toBe('used');
  });

  /**
   * `remaining_amount` survives, deliberately.
   *
   * An expired card still records what was on it — that is the evidence of what SAFRA stopped
   * owing and when, and a goodwill reissue is decided by reading exactly that.
   */
  it('keeps the balance it stopped owing', async () => {
    const due = await card(-24);

    await expiry.sweep();

    const rows = await db.execute<{ remaining: string }>(sql`
      SELECT remaining_amount::text AS remaining FROM gift_cards WHERE reference = ${due}
    `);

    expect(rows.rows[0]?.remaining).toBe('100.000');
  });

  /**
   * And the screen does not wait an hour to tell the truth.
   *
   * The card below expired one second ago and the sweep has NOT run. Before the list computed an
   * effective status this read «نشطة» — about a card redemption would refuse in the same second.
   */
  it('reads as expired on the console before the sweep has run', async () => {
    const due = await card(-1);

    const page = await promotions.giftCards({ page: 1, limit: 50 });
    const shown = page.items.find((item) => item.reference === due);

    expect(shown, 'the card is on the page').toBeDefined();
    expect(shown?.status).toBe('expired');

    /* The control: the column itself is still `active`, so this is the SELECT and not the sweep. */
    expect(await statusOf(due)).toBe('active');
  });

  /**
   * The balance leaves the books when the card lapses (Bashar, 2026-10-07).
   *
   * Until then the sweep changed only the status, and every expired card's balance stayed on
   * `gift_card_redemption`, so the books said SAFRA owed money nobody could ever claim.
   */
  describe('and its unspent balance', () => {
    /** The ledger legs written for this card, by its reference: a fresh card has no others. */
    const legsOf = async (reference: string) =>
      (
        await db.execute<{ account: string; direction: string; amount: string }>(sql`
          SELECT account::text, direction::text, amount::text FROM ledger_entries
          WHERE description LIKE ${'%' + reference + '%'}
          ORDER BY account
        `)
      ).rows;

    it('becomes SAFRA income when a customer bought the card', async () => {
      const due = await card(-1, 'active', { remaining: '60.00', bought: true });

      await expiry.sweep();

      expect(await legsOf(due)).toEqual([
        { account: 'gift_card_breakage', direction: 'credit', amount: '60.000' },
        { account: 'gift_card_redemption', direction: 'debit', amount: '60.000' },
      ]);
    });

    it('reverses the giveaway when SAFRA issued the card', async () => {
      const due = await card(-1, 'active', { remaining: '25.00' });

      await expiry.sweep();

      expect(await legsOf(due)).toEqual([
        { account: 'gift_card_issued', direction: 'credit', amount: '25.000' },
        { account: 'gift_card_redemption', direction: 'debit', amount: '25.000' },
      ]);
    });

    /* Nothing owed, nothing to move: a ledger group of zeros would be noise in every report. */
    it('posts nothing for a card with nothing left on it', async () => {
      const due = await card(-1, 'active', { remaining: '0.00', bought: true });

      await expiry.sweep();

      expect(await statusOf(due)).toBe('expired');
      expect(await legsOf(due)).toEqual([]);
    });

    /* The guard is the status: a second sweep finds the card retired and posts nothing again. */
    it('posts once however many times the sweep runs', async () => {
      const due = await card(-1, 'active', { remaining: '40.00', bought: true });

      await expiry.sweep();
      await expiry.sweep();

      expect(await legsOf(due)).toHaveLength(2);
    });

    /*
      A currency with no rate to SYP cannot be valued, so its card cannot be posted. It must stay
      active, liability standing, rather than be retired with the books still owing it, and it
      must not stop the cards behind it.
    */
    it('leaves a card it cannot value active, and retires the rest', async () => {
      /*
        A currency of the test's own, made inside its rolled-back transaction: a fresh database has a
        rate for every currency it seeds, so borrowing one without a rate found nothing on CI.
      */
      const code = 'ZZX';

      await db.execute(sql`
        INSERT INTO currencies (code, name_ar, name_en, name_de, symbol)
        VALUES (${code}, 'عملة اختبار', 'Test currency', 'Testwährung', '¤')
      `);

      const stuck = await card(-2, 'active', { currency: code, bought: true });
      const fine = await card(-1, 'active', { bought: true });

      await expiry.sweep();

      expect(await statusOf(stuck), 'not retired with its liability standing').toBe(
        'active',
      );
      expect(await legsOf(stuck)).toEqual([]);
      expect(await statusOf(fine), 'and the card behind it still retired').toBe(
        'expired',
      );
    });
  });
});
