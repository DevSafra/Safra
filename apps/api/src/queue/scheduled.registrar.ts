import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { JOB_OPTIONS } from './queue.definitions.js';
import {
  SCHEDULED_JOBS,
  scheduledJobId,
  type ScheduledJobName,
} from './scheduled.job.js';
import { SCHEDULED_QUEUE } from './queue.tokens.js';
import { describeError } from '../common/errors/safe-error.js';

/**
 * Declares the five repeatable jobs at boot, and removes any that no longer exist.
 *
 * ## Why a repeatable job needs declaring at all
 *
 * A BullMQ schedule lives in REDIS, not in the code. `upsertJobScheduler` is idempotent — the same
 * key with the same pattern is a no-op — so every API replica declaring all five at boot converges
 * on exactly five schedules, however many replicas there are. That is the property that replaces
 * `@Cron` firing on each of them.
 *
 * ## Why it also DELETES
 *
 * This is the half that is easy to leave out and expensive to have left out. A schedule persists in
 * Redis after the code that created it is gone: rename a job, or change its cron expression, and
 * the old schedule keeps firing forever, producing jobs whose name no worker recognises — which
 * dead-letter, page somebody, and cannot be stopped by deploying anything. So the reconciliation is
 * two-way: declare what should exist, remove what should not.
 *
 * ## Why it runs in the API and not only in the worker
 *
 * Declaring is a producer concern, exactly like enqueueing a mail. A worker that declared its own
 * schedules would mean scaling workers to zero silently unschedules the platform's recurring work,
 * and the SLA sweep stopping is the failure this whole area exists to make visible.
 */
@Injectable()
export class ScheduledRegistrar implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScheduledRegistrar.name);

  constructor(@Inject(SCHEDULED_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.reconcile();
    } catch (error) {
      /*
        Swallowed, like every other enqueue in this codebase. A Redis that is briefly unreachable at
        boot must not stop the API from serving requests — and the consequence is visible rather
        than silent: no schedule means no `scheduled_job_runs` rows, which is precisely what
        `safra_job_last_success_age_seconds` alerts on.
      */
      this.logger.error(
        `Could not declare the recurring jobs: ` +
          `${describeError(error)}. ` +
          'Recurring work will not run until this succeeds.',
      );
    }
  }

  /** Declares every job that should exist, and deletes every schedule that should not. */
  private async reconcile(): Promise<void> {
    const wanted = new Set(
      (Object.keys(SCHEDULED_JOBS) as ScheduledJobName[]).map(scheduledJobId),
    );

    for (const [job, pattern] of Object.entries(SCHEDULED_JOBS)) {
      await this.queue.upsertJobScheduler(
        scheduledJobId(job as ScheduledJobName),
        { pattern },
        {
          name: job,
          data: { job },
          opts: JOB_OPTIONS.scheduled,
        },
      );
    }

    const existing = await this.queue.getJobSchedulers();

    for (const scheduler of existing) {
      if (scheduler.key && !wanted.has(scheduler.key)) {
        await this.queue.removeJobScheduler(scheduler.key);
        this.logger.warn(`Removed an obsolete schedule: ${scheduler.key}.`);
      }
    }

    this.logger.log(`Declared ${wanted.size} recurring jobs on the scheduled queue.`);
  }
}
