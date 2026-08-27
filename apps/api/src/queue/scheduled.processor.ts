import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { SlaService } from '../bookings/sla.service.js';
import { PayoutScheduler } from '../payouts/payout.scheduler.js';
import { RankingScheduler } from '../ranking/ranking.scheduler.js';
import { SanctionsRefreshService } from '../sanctions/sanctions-refresh.service.js';
import { CredentialRetentionService } from '../auth/credential-retention.service.js';
import { WebhookRetentionService } from '../payments/webhook-retention.service.js';
import { NotificationRedriveService } from '../notifications/notification-redrive.service.js';
import { JobRunService } from '../common/jobs/job-run.service.js';
import { QUEUE } from './queue.definitions.js';
import { DeadLetterService } from './dead-letter.service.js';
import { SCHEDULED_JOBS, type ScheduledJobData } from './scheduled.job.js';
import { SystemRefundService } from '../payments/system-refund.service.js';
import { GiftCardExpiryService } from '../gift-cards/gift-card-expiry.service.js';
import { AdExpiryService } from '../admin/ad-expiry.service.js';
import { StayCompletionService } from '../bookings/stay-completion.service.js';
import { describeError } from '../common/errors/safe-error.js';

/**
 * The `scheduled` queue's worker-side body: five recurring jobs, dispatched by name.
 *
 * ## It calls the SAME methods the decorators call
 *
 * Not copies of them. `docs/background-jobs-design.md` is explicit that migrating a scheduler means
 * "move the body into a processor unchanged" — and the safest reading of unchanged is that there is
 * only one body, invoked from two places. Every one of these already wraps itself in
 * `JobRunService.runExclusively`, so the `scheduled_job_runs` row that the runbook queries and that
 * `safra_job_last_success_age_seconds` alerts on keeps being written from exactly where it was.
 *
 * **The queue records attempts; that table records business outcome, and they are not the same
 * thing.** Nothing here writes to it.
 *
 * ## Why the advisory lock stayed
 *
 * `docs/background-jobs-design.md` lists dropping it as part of phase 6, on the grounds that
 * `scheduled` at concurrency 1 is "a stronger guarantee across a cluster than a lock this codebase
 * has to remember to take". The first half is true and the second stopped being true in phase 4:
 * the lock now lives inside `JobRunService.runExclusively`, which is the only way any of these
 * bodies is reached, so there is nothing left for anybody to remember.
 *
 * What removing it would cost is a safety net against the case the queue does not cover — anything
 * that invokes a job body OUTSIDE the queue. A "run now" button in the console is an obvious future
 * feature, and the failure it would cause is payout accrual running twice. Two round trips per job
 * run is not a price worth paying to delete that. The deviation is recorded in the design doc.
 *
 * ## What a failure means here
 *
 * It throws, and BullMQ retries twice with a fixed five-minute backoff — fixed rather than
 * exponential because a repeatable job has a NEXT occurrence, so a long backoff just skips it. The
 * SLA sweep is the one that matters: it runs every minute and it is what pays compensation, so an
 * attempt that fails is followed by another attempt long before the damage is measured in
 * customers.
 */
@Injectable()
export class ScheduledProcessor {
  private readonly logger = new Logger(ScheduledProcessor.name);

  constructor(
    private readonly sla: SlaService,
    private readonly payouts: PayoutScheduler,
    private readonly stays: StayCompletionService,
    private readonly ranking: RankingScheduler,
    private readonly sanctions: SanctionsRefreshService,
    private readonly retention: WebhookRetentionService,
    private readonly credentials: CredentialRetentionService,
    private readonly redrive: NotificationRedriveService,
    private readonly systemRefunds: SystemRefundService,
    private readonly giftCardExpiry: GiftCardExpiryService,
    private readonly adExpiry: AdExpiryService,
    private readonly runs: JobRunService,
    private readonly deadLetters: DeadLetterService,
  ) {}

  /** Runs one occurrence. Throws to request a retry. */
  async process(job: Job<ScheduledJobData>): Promise<void> {
    const name = job.data.job;

    if (!(name in SCHEDULED_JOBS)) {
      /* Deploy skew, or a repeatable schedule left in Redis by a version that knew a sixth job. */
      throw new Error(`Unknown job on the ${QUEUE.scheduled} queue: ${String(name)}`);
    }

    this.logger.debug(`Running ${name}.`);

    /*
      An exhaustive switch rather than a lookup object.

      The five services are injected, so a map built in the constructor would work — and would
      compile happily with a job missing from it, failing at 03:00 instead of at build time. With a
      `never` in the default branch, adding a name to `SCHEDULED_JOBS` and not here does not type
      check.
    */
    switch (name) {
      case 'booking-sla-sweep':
        return this.sla.sweep();
      case 'payout-accrual':
        return this.payouts.run();
      case 'stay-completion':
        return this.stays.sweep();
      case 'system-refunds':
        return this.systemRefunds.sweep();
      case 'gift-card-expiry':
        return this.giftCardExpiry.sweep();
      case 'ad-campaign-expiry':
        return this.adExpiry.sweep();
      case 'ranking-recompute':
        return this.ranking.nightlyRecompute();
      case 'sanctions-refresh':
        return this.sanctions.refresh();
      case 'webhook-retention':
        return this.retention.prune();
      case 'credential-retention':
        return this.credentials.prune();
      case 'notification-redrive':
        /*
          Wrapped HERE rather than inside the service, unlike the other five.

          Those five predate the queue and own their own `runExclusively` call because they used to
          be reached from a `@Cron` decorator too. This one has only ever had one caller, so the
          recording belongs at the call site and `NotificationRedriveService` stays a plain service
          that returns what it did.
        */
        return this.runs.runExclusively('notification-redrive', 771_120_045, () =>
          this.redrive.run(),
        );
      default: {
        const unreachable: never = name;

        throw new Error(`Unhandled scheduled job: ${String(unreachable)}`);
      }
    }
  }

  /**
   * Called on every failed attempt; records only the last one.
   *
   * A dead letter for a recurring job is a different signal from one for a mail or a media job: the
   * work is not lost, because the next occurrence is coming. What it says is that this job is
   * failing repeatedly — which is exactly what the SLA sweep silently doing nothing used to look
   * like, and the reason `scheduled_job_runs` exists.
   */
  async onFailed(job: Job<ScheduledJobData> | undefined, error: Error): Promise<void> {
    if (!job) {
      this.logger.error(
        `A ${QUEUE.scheduled} job failed before it could be read: ${describeError(error)}`,
      );

      return;
    }

    const attempts = job.opts.attempts ?? 1;

    if (job.attemptsMade < attempts) return;

    await this.deadLetters.record({
      queue: QUEUE.scheduled,
      name: job.name,
      jobId: String(job.id ?? ''),
      /* One field, and it is a name from a closed set. Nothing to redact and nothing to leak. */
      payload: job.data,
      error,
      attempts: job.attemptsMade,
    });
  }
}
