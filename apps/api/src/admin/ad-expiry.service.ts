import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { JobRunService } from '../common/jobs/job-run.service.js';
import { describeError } from '../common/errors/safe-error.js';

/** Its own advisory-lock key — see `SlaService` for what sharing one costs. */
const AD_EXPIRY_LOCK_KEY = 8_421_010;

/**
 * Retires ad campaigns whose paid window has closed.
 *
 * ## `expired` was a status nothing could write, and a guard depended on it
 *
 * `ad_status` has four values and three had writers. `setStatus` refused to resume a campaign whose
 * `status` was `expired` — and nothing ever set it, so the refusal could never fire. A campaign
 * whose window closed last month could be flipped straight back to `active`, delivering impressions
 * the advertiser never bought. The service's own comment described exactly that risk.
 *
 * The guard now asks the CLOCK, so the hole is closed whether or not this runs. What this adds is
 * the column being TRUE for everything that queries it without knowing to compensate — a report, an
 * export, the delivery endpoint, a service nobody has written yet.
 *
 * ## Hourly, at :20
 *
 * A campaign's window closes at an instant. Off the hour so it does not stack with
 * `payout-accrual` and `booking-sla-sweep`, and off :45 where `gift-card-expiry` runs.
 */
@Injectable()
export class AdExpiryService {
  private readonly logger = new Logger(AdExpiryService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly runs: JobRunService,
  ) {}

  async sweep(): Promise<void> {
    await this.runs
      .runExclusively('ad-campaign-expiry', AD_EXPIRY_LOCK_KEY, async () => ({
        expired: await this.retireLapsed(),
      }))
      .catch((error: unknown) => {
        /*
          Swallowed after the row is written, as the other sweeps do: `runExclusively` records the
          failure and re-throws so the queue retries, and an unhandled rejection on the fallback
          path would take the API down for something the next hour would have retried.
        */
        this.logger.error(`Ad campaign expiry failed: ${describeError(error)}`);
      });
  }

  /**
   * Every campaign past its window, in one bounded statement.
   *
   * `draft` is included deliberately: a campaign written for a window that has since passed is
   * expired whether or not anybody activated it, and leaving it as a draft invites somebody to
   * activate it into a window that has closed.
   *
   * Ordered by `ends_at` so the longest-wrong is always in the batch, and bounded so a backlog
   * after an outage does not become one statement holding locks across the table (rule 2).
   */
  private async retireLapsed(limit = 500): Promise<number> {
    const result = await this.db.execute<{ id: string }>(sql`
      WITH due AS (
        SELECT id FROM ad_campaigns
        WHERE status <> 'expired'
          AND ends_at <= now()
          AND deleted_at IS NULL
        ORDER BY ends_at
        LIMIT ${limit}
      )
      UPDATE ad_campaigns
      SET status = 'expired', updated_at = now()
      WHERE id IN (SELECT id FROM due)
      RETURNING id
    `);

    if (result.rows.length > 0) {
      this.logger.log(`Retired ${result.rows.length} expired ad campaign(s).`);
    }

    return result.rows.length;
  }
}
