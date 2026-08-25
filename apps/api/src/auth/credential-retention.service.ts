import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { JobRunService } from '../common/jobs/job-run.service.js';
import { describeError } from '../common/errors/safe-error.js';

/** Distinct advisory-lock key per job; see RankingScheduler for the rationale. */
const RETENTION_LOCK_KEY = 8_421_005;

/**
 * How long a spent sign-in code is kept.
 *
 * A code lives ten minutes, so anything here is already dead as a credential — `verify` reads only
 * the newest unconsumed, unexpired row and cannot be reached by any of these. What is left is
 * EVIDENCE: which address asked for a code, when, and how many wrong guesses were made against it,
 * which is what an account-takeover investigation reads.
 *
 * A week is long enough for somebody to notice a strange sign-in and ask, short enough that a table
 * written to on every partner sign-in does not grow without end.
 */
const LOGIN_CODE_RETENTION_DAYS = 7;

/**
 * How long a dead refresh token is kept.
 *
 * Longer than the codes, because the question these answer is slower to arrive: a family revoked by
 * replay detection is the record of a stolen session, and "when did this start" is asked weeks
 * later rather than days. `TokenService.rotate` revokes a whole family on reuse, so the row that
 * matters is usually surrounded by siblings that only make sense together.
 *
 * A LIVE token is never touched here, whatever its age — see the predicate.
 */
const REFRESH_TOKEN_RETENTION_DAYS = 90;

/** Deleted per pass, so a large backlog is worked through without a long lock. */
const BATCH_SIZE = 5_000;

/**
 * Removes credentials that have stopped being credentials.
 *
 * ## The problem this closes (`O-sec-6`, `O-sec-11`)
 *
 * Two tables were written to on every sign-in and never read from again, and nothing deleted a
 * row from either. `refresh_tokens` gains a row per sign-in and per rotation — every fifteen
 * minutes, per active session — and `login_codes` gains one per partner sign-in attempt. Neither
 * had a sweep, so both grew for ever, which rule 2 forbids outright.
 *
 * Nothing was WRONG: an expired token is refused on its expiry, and a spent code is invisible to
 * `verify`. This is unbounded growth rather than a hole — the shape rule 2 exists to catch before
 * it becomes one.
 *
 * ## It is a retention job as much as a capacity one
 *
 * Both tables carry `ip_address` and `user_agent` against a user id. That is personal data under
 * §14, kept for a purpose — investigating account takeover — and §14 asks that data kept for a
 * purpose stops being kept when the purpose has passed. The two windows below are engineering
 * defaults chosen for that reason, and blocker #6 (the retention and erasure policy) is where they
 * get confirmed or replaced by somebody who can decide it. They are named constants so that
 * conversation changes one line each.
 *
 * ## What it deliberately does NOT delete
 *
 * A live refresh token, however old. Age is not death: a session refreshed this morning on a token
 * issued in January is a person who is signed in, and deleting the row would sign them out to save
 * a few bytes. The predicate asks whether the token is spent or expired, never how old it is on
 * its own.
 *
 * `auth_tokens` — password resets, email verifications, partner invitations — is deliberately out
 * of scope. Those are single-use and short-lived like the codes, but they are also the evidence
 * that an account was recovered, and pruning them belongs with the same policy decision rather
 * than ahead of it. Recorded in `O-sec-11`.
 */
@Injectable()
export class CredentialRetentionService {
  private readonly logger = new Logger(CredentialRetentionService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly runs: JobRunService,
  ) {}

  async prune(): Promise<void> {
    /* The lock AND the run record, in one place — see the note in `SlaService.sweep`. */
    await this.runs
      .runExclusively('credential-retention', RETENTION_LOCK_KEY, async () => {
        const codes = await this.pruneLoginCodes();
        const tokens = await this.pruneRefreshTokens();

        if (codes > 0 || tokens > 0) {
          this.logger.log(
            `Pruned ${codes} spent sign-in code(s) older than ` +
              `${LOGIN_CODE_RETENTION_DAYS} days and ${tokens} dead refresh token(s) older ` +
              `than ${REFRESH_TOKEN_RETENTION_DAYS} days.`,
          );
        }

        return { codes, tokens };
      })
      .catch((error: unknown) => {
        /*
          Recorded first, then swallowed. A failed prune only means the tables stay larger for
          another day, and an unhandled rejection would be a worse outcome than that.
        */
        this.logger.error(
          `Credential retention pass failed: ` + `${describeError(error)}`,
        );
      });
  }

  /**
   * Sign-in codes that can no longer be redeemed.
   *
   * Consumed OR expired — not both. A code that was never used is as dead as one that was, ten
   * minutes after it was issued, and the row is the same evidence either way.
   *
   * Exposed for the integration test, which cannot wait for 03:00.
   */
  async pruneLoginCodes(): Promise<number> {
    return this.deleteInBatches(sql`
      DELETE FROM login_codes
      WHERE id IN (
        SELECT id FROM login_codes
        WHERE (consumed_at IS NOT NULL OR expires_at <= now())
          AND created_at < now() - ${`${LOGIN_CODE_RETENTION_DAYS} days`}::interval
        LIMIT ${BATCH_SIZE}
      )
      RETURNING id
    `);
  }

  /**
   * Refresh tokens that can no longer mint a session.
   *
   * `revoked_at IS NOT NULL OR expires_at <= now()` — a live token is never matched, whatever its
   * age. That is the whole safety of this statement: get the predicate wrong and the job signs
   * every partner and customer out.
   */
  async pruneRefreshTokens(): Promise<number> {
    return this.deleteInBatches(sql`
      DELETE FROM refresh_tokens
      WHERE id IN (
        SELECT id FROM refresh_tokens
        WHERE (revoked_at IS NOT NULL OR expires_at <= now())
          AND created_at < now() - ${`${REFRESH_TOKEN_RETENTION_DAYS} days`}::interval
        LIMIT ${BATCH_SIZE}
      )
      RETURNING id
    `);
  }

  /**
   * Runs one `DELETE … LIMIT` until it stops finding rows.
   *
   * A single unbounded `DELETE` over a table that has been growing since launch would hold locks
   * and bloat WAL for as long as it ran. Batching keeps each statement short, and a pass that is
   * interrupted simply resumes tomorrow — the same reasoning `WebhookRetentionService` records.
   */
  private async deleteInBatches(statement: ReturnType<typeof sql>): Promise<number> {
    let total = 0;

    for (;;) {
      const result = await this.db.execute<{ id: string }>(statement);

      total += result.rows.length;

      if (result.rows.length < BATCH_SIZE) return total;
    }
  }
}
