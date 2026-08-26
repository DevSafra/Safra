import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { JobRunService } from '../common/jobs/job-run.service.js';
import { describeError } from '../common/errors/safe-error.js';

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
   * Every active card whose expiry has passed, in one statement.
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
   * outage must not become one statement holding row locks across the table (rule 2); the next
   * hour takes the next batch, and the sweep is self-healing precisely because it can be re-run.
   *
   * ## `remaining_amount` is left alone, deliberately
   *
   * An expired card still records what was on it. Zeroing it would destroy the evidence of what
   * SAFRA stopped owing and when — and a cancellation or a goodwill reissue is decided by reading
   * exactly that. The status says it cannot be spent; the amount says what it was.
   */
  private async retireExpiredCards(limit = 500): Promise<number> {
    const result = await this.db.execute<{ id: string }>(sql`
      WITH due AS (
        SELECT id FROM gift_cards
        WHERE status = 'active'
          AND expires_at IS NOT NULL
          AND expires_at <= now()
        ORDER BY expires_at
        LIMIT ${limit}
      )
      UPDATE gift_cards
      SET status = 'expired', updated_at = now()
      WHERE id IN (SELECT id FROM due)
      RETURNING id
    `);

    if (result.rows.length > 0) {
      this.logger.log(`Retired ${result.rows.length} expired gift card(s).`);
    }

    return result.rows.length;
  }
}
