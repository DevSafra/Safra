import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { JobRunService } from '../common/jobs/job-run.service.js';
import { RecommendationService } from './recommendation.service.js';

/**
 * Arbitrary but fixed key identifying this job's advisory lock. Any 64-bit int
 * works; it only has to be unique among the locks this application takes.
 */
const RANKING_LOCK_KEY = 8_421_001;

@Injectable()
export class RankingScheduler {
  constructor(
    private readonly recommendation: RecommendationService,
    private readonly runs: JobRunService,
  ) {}

  /**
   * Nightly recompute of "SAFRA recommends" (§5.5).
   *
   * 03:00 is chosen to sit after midnight in all three launch markets (UTC+2/+3)
   * while still being the quietest part of their night.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'ranking-recompute' })
  async nightlyRecompute(): Promise<void> {
    await this.runs.runExclusively('ranking-recompute', RANKING_LOCK_KEY, async () => {
      const scores = await this.recommendation.recomputeAll();
      const badges = await this.recommendation.refreshBadges();

      return { scores: scores.updated, badges: badges.updated };
    });
  }

  /*
    The lock-and-record mechanism moved to `JobRunService`.

    It was a private helper here, and the payout accrual needed exactly the same thing — at which
    point a second copy would have been a second place for "only one replica runs this" to be
    subtly different. The service also writes a `scheduled_job_runs` row, which is what makes a
    job that has STOPPED firing visible; a log line cannot express an absence.

    This remains the interim mechanism. Once BullMQ lands (§14 requires a background queue) these
    jobs move there and gain retries and per-job observability.
  */
}
