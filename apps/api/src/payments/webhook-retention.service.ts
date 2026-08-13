import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { JobRunService } from '../common/jobs/job-run.service.js';

/** Distinct advisory-lock key per job; see RankingScheduler for the rationale. */
const RETENTION_LOCK_KEY = 8_421_004;

/**
 * How long an unverified webhook is kept.
 *
 * Long enough to investigate an incident that surfaced a week or two later, short
 * enough that noise cannot accumulate indefinitely. These rows are, by definition,
 * payloads nobody could authenticate — mostly scanner traffic and the occasional
 * misconfigured integration.
 */
const UNVERIFIED_RETENTION_DAYS = 30;

/** Deleted per pass, so a large backlog is worked through without a long lock. */
const BATCH_SIZE = 5_000;

/**
 * Prunes webhook payloads that failed signature verification.
 *
 * ## The problem this closes
 *
 * `POST /payments/webhook/:provider` is `@Public()` by necessity — a gateway cannot
 * hold a session — and it answers `200` even for an invalid signature, deliberately,
 * because a `4xx` makes most providers retry forever and some disable the endpoint
 * after repeated rejections. Unverified payloads are recorded and never acted upon,
 * which is the right call: the record is the forensic evidence.
 *
 * But nothing removed them. An unauthenticated caller could therefore grow the table
 * without limit, one ~100 KB row at a time (the body limit), at 300 requests per
 * minute per IP. Measured on 2026-08-02: routine probing left **1,208 rows / 776 kB**
 * behind. Sustained from a handful of addresses that is tens of megabytes an hour of
 * unauthenticated write amplification against the primary database — a slow
 * availability problem rather than a breach, but one with no natural ceiling.
 *
 * ## What is deliberately NOT pruned
 *
 * Anything with a verified signature. Those are financial records: the evidence that
 * a provider told us a payment was captured, and the reason a ledger entry exists.
 * They are governed by financial retention, not by this job, and deleting them to
 * save space would destroy the audit trail §15 exists to preserve.
 */
@Injectable()
export class WebhookRetentionService {
  private readonly logger = new Logger(WebhookRetentionService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly runs: JobRunService,
  ) {}

  async prune(): Promise<void> {
    /* The lock AND the run record, in one place — see the note in `SlaService.sweep`. */
    await this.runs
      .runExclusively('webhook-retention', RETENTION_LOCK_KEY, async () => {
        const deleted = await this.pruneUnverified();

        if (deleted > 0) {
          this.logger.log(
            `Pruned ${deleted} unverified webhook payload(s) older than ` +
              `${UNVERIFIED_RETENTION_DAYS} days.`,
          );
        }

        return { deleted };
      })
      .catch((error: unknown) => {
        /**
         * Recorded first, then swallowed — an unhandled rejection on the `@Cron` fallback path
         * kills the process, and a failed prune only means the table stays larger for another day.
         */
        this.logger.error(
          `Webhook retention pass failed: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  /**
   * Deletes in batches until nothing old remains.
   *
   * One large `DELETE` over a table that an attacker may have grown to millions of
   * rows would hold locks and bloat WAL for as long as it ran. Batching keeps each
   * statement short, and a pass that is interrupted simply resumes tomorrow.
   *
   * Exposed for the integration test, which cannot wait for 03:00.
   */
  async pruneUnverified(): Promise<number> {
    let total = 0;

    for (;;) {
      const result = await this.db.execute<{ id: string }>(sql`
        DELETE FROM payment_provider_events
        WHERE id IN (
          SELECT id FROM payment_provider_events
          WHERE signature_verified = false
            AND processed_at IS NULL
            AND created_at < now() - ${`${UNVERIFIED_RETENTION_DAYS} days`}::interval
          LIMIT ${BATCH_SIZE}
        )
        RETURNING id
      `);

      total += result.rows.length;

      if (result.rows.length < BATCH_SIZE) return total;
    }
  }
}
