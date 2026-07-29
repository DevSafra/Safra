import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { RecommendationService } from './recommendation.service.js';

/**
 * Arbitrary but fixed key identifying this job's advisory lock. Any 64-bit int
 * works; it only has to be unique among the locks this application takes.
 */
const RANKING_LOCK_KEY = 8_421_001;

@Injectable()
export class RankingScheduler {
  private readonly logger = new Logger(RankingScheduler.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly recommendation: RecommendationService,
  ) {}

  /**
   * Nightly recompute of "SAFRA recommends" (§5.5).
   *
   * 03:00 is chosen to sit after midnight in all three launch markets (UTC+2/+3)
   * while still being the quietest part of their night.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'ranking-recompute' })
  async nightlyRecompute(): Promise<void> {
    await this.runExclusively(async () => {
      const scores = await this.recommendation.recomputeAll();
      const badges = await this.recommendation.refreshBadges();
      this.logger.log(
        `Nightly ranking complete: ${scores.updated} scores, ${badges.updated} badges changed.`,
      );
    });
  }

  /**
   * Runs a job on exactly ONE instance, using a PostgreSQL advisory lock.
   *
   * This matters because the API is deliberately stateless and horizontally
   * scaled (rule 2). A @Cron decorator fires on EVERY replica, so four app nodes
   * would run the same recompute four times concurrently — wasted work at best,
   * and at worst four transactions updating the same rows and deadlocking.
   *
   * pg_try_advisory_lock returns immediately rather than queueing: a replica that
   * does not get the lock simply skips this tick, which is the correct behaviour
   * for an idempotent nightly job. The lock is session-scoped and released in a
   * finally block, and would be released automatically if the connection died.
   *
   * This is the interim mechanism. Once BullMQ lands in Phase 5 (§14 requires a
   * background queue), the job moves there and gets retries and observability;
   * a single-instance guarantee is all that is needed until then.
   */
  private async runExclusively(job: () => Promise<void>): Promise<void> {
    const acquired = await this.db.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_lock(${RANKING_LOCK_KEY}) AS locked`,
    );

    if (acquired.rows[0]?.locked !== true) {
      this.logger.debug('Ranking recompute skipped: another instance holds the lock.');
      return;
    }

    try {
      await job();
    } catch (error) {
      // Swallowed deliberately: an unhandled rejection in a scheduled job takes
      // the whole process down, and a failed ranking pass must not do that. The
      // next tick retries, and stale scores degrade ordering rather than breaking
      // search.
      this.logger.error(
        `Ranking recompute failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await this.db.execute(sql`SELECT pg_advisory_unlock(${RANKING_LOCK_KEY})`);
    }
  }
}
