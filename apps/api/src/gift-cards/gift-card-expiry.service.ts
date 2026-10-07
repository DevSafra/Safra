import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { JobRunService } from '../common/jobs/job-run.service.js';
import { describeError } from '../common/errors/safe-error.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { LedgerService } from '../ledger/ledger.service.js';

/** Its own advisory-lock key — see `SlaService` for what sharing one costs. */
const GIFT_CARD_EXPIRY_LOCK_KEY = 8_421_009;

/**
 * Retires gift cards whose expiry has passed.
 *
 * ## `expired` was a status nothing could ever write
 *
 * `gift_card_status` has four values and only three had a writer: `active` on creation, `used` on
 * redemption, `cancelled` by hand. A card past `expires_at` kept `status = 'active'` for ever.
 *
 * **No money was ever at risk**, and that is worth stating plainly: `redeem()` compares
 * `expires_at` against `now()` inside the transaction, after the row lock, so an expired card is
 * refused whatever its column says. What the column costs is TRUTH — بطاقات الهدايا painted
 * «نشطة» on a card that cannot be used, and any figure filtering `status = 'active'` counted it as
 * live liability. An operator answering «why did my card not work» would have been reading a
 * screen that said it should have.
 *
 * ## Hourly, not daily
 *
 * A card expires at an instant, not on a date the platform gets to round. Daily would leave a
 * window of up to 24 hours where the screen and the redemption path disagree — which is the whole
 * defect, just smaller. Hourly costs one indexed probe against a partial index that matches only
 * cards actually due, and the ordinary result is zero rows.
 *
 * At :45, so it does not land on the hour with `payout-accrual` and `booking-sla-sweep`.
 *
 * ## The list does not wait for it
 *
 * `PromotionsService` computes the effective status in its SELECT, so a card that expired a minute
 * ago already reads «منتهية» before this has run. That is not redundant with the sweep and does not
 * replace it: the screen must never lie, and the COLUMN must be right for everything that queries
 * it without knowing to compensate — a report, an export, a future service. Same argument
 * `contractTone` makes on الشركاء, where the calendar overrules the column.
 */
@Injectable()
export class GiftCardExpiryService {
  private readonly logger = new Logger(GiftCardExpiryService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly runs: JobRunService,
    private readonly ledger: LedgerService,
    private readonly fx: FxRateService,
  ) {}

  async sweep(): Promise<void> {
    await this.runs
      .runExclusively('gift-card-expiry', GIFT_CARD_EXPIRY_LOCK_KEY, async () => ({
        expired: await this.retireExpiredCards(),
      }))
      .catch((error: unknown) => {
        /*
          Swallowed after the row is written, as the other sweeps do: `runExclusively` records the
          failure and re-throws so the queue retries, and an unhandled rejection on the fallback
          path would take the API down for something the next hour would have retried.
        */
        this.logger.error(`Gift card expiry failed: ${describeError(error)}`);
      });
  }

  /**
   * Every active card whose expiry has passed, each retired in its own transaction.
   *
   * ## An instant, not a date
   *
   * `expires_at` is a timestamptz, so `now()` is the right comparison and there is no timezone
   * question to get wrong — unlike a stay's check-out, which is a calendar date in the property's
   * own zone. A card is a bearer instrument with no location.
   *
   * ## Bounded, and the bound is not arbitrary
   *
   * `LIMIT` keeps one sweep's work bounded however long the job has been down. A backlog after an
   * outage takes the next batch the next hour, and the sweep is self-healing because it can re-run.
   *
   * ## One card, one transaction: the status and the books move together
   *
   * Until 2026-10-07 expiry changed only the status, so an expired card's balance stayed on
   * `gift_card_redemption` for ever: the books said SAFRA owed money nobody could ever claim. Now
   * the balance leaves the liability in the same transaction that retires the card (see `retire`).
   * A card that cannot be posted, which today means a currency with no rate to SYP, is left active
   * and retried next hour rather than retired with its liability still standing; the failure is
   * logged with the card's reference.
   */
  private async retireExpiredCards(limit = 500): Promise<number> {
    const due = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM gift_cards
      WHERE status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at <= now()
      ORDER BY expires_at
      LIMIT ${limit}
    `);

    let retired = 0;

    for (const { id } of due.rows) {
      try {
        if (await this.retire(id)) retired += 1;
      } catch (error) {
        this.logger.error(
          `Gift card ${id} could not be retired: ${describeError(error)}`,
        );
      }
    }

    if (retired > 0) this.logger.log(`Retired ${retired} expired gift card(s).`);

    return retired;
  }

  /**
   * Retires one card and takes its unspent balance off the books.
   *
   * The balance is not owed any more, and where it goes depends on who paid for it (Bashar,
   * 2026-10-07):
   *
   * - a card a customer BOUGHT: their money, now SAFRA's income, `gift_card_breakage`;
   * - a card SAFRA GAVE away: never anybody's money, so the lapse reverses `gift_card_issued`, the
   *   expense it was booked against, exactly as a cancellation does.
   *
   * `remaining_amount` is left alone, deliberately: it records what was on the card when it lapsed,
   * which is what a goodwill reissue or a complaint is decided by. The status says it cannot be
   * spent; the ledger says it is no longer owed.
   *
   * Guarded on `status = 'active'` under a row lock, so a card redeemed or cancelled in the same
   * moment is not retired as well, and a sweep that runs twice posts once.
   */
  private async retire(id: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<{
        reference: string;
        remaining: string;
        currency_id: string;
        currency_code: string;
        buyer: string | null;
      }>(sql`
        UPDATE gift_cards g
        SET status = 'expired', updated_at = now()
        FROM currencies c
        WHERE g.id = ${id}::uuid
          AND c.id = g.currency_id
          AND g.status = 'active'
          AND g.expires_at <= now()
        RETURNING g.reference, g.remaining_amount::text AS remaining, g.currency_id,
                  c.code AS currency_code, g.purchased_by_customer_id AS buyer
      `);

      const card = rows.rows[0];

      if (!card) return false;
      if (Number(card.remaining) <= 0) return true;

      const bought = card.buyer !== null;

      await this.ledger.post(
        tx as unknown as Database,
        [
          {
            account: 'gift_card_redemption',
            direction: 'debit',
            amount: card.remaining,
            description: `Gift card ${card.reference} expired`,
          },
          bought
            ? {
                account: 'gift_card_breakage',
                direction: 'credit',
                amount: card.remaining,
                description: `Unspent balance of expired gift card ${card.reference}`,
              }
            : {
                account: 'gift_card_issued',
                direction: 'credit',
                amount: card.remaining,
                description: `Issued gift card ${card.reference} expired unspent`,
              },
        ],
        {
          currencyId: card.currency_id,
          fxRateToSyp: await this.fx.rateToSyp(card.currency_code),
          customerProfileId: card.buyer ?? undefined,
        },
      );

      return true;
    });
  }
}
