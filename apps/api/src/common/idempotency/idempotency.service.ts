import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../../database/database.module.js';
import { ERROR } from '@safra/contracts';
import { conflict } from '../errors/app-error.js';
import { describeError } from '../errors/safe-error.js';
import { errorMessage } from '@safra/i18n';

/** How long a completed response is replayable. */
const RETENTION_HOURS = 24;

/** PostgreSQL's unique-violation code. */
const UNIQUE_VIOLATION = '23505';

/**
 * After this long, an `in_progress` claim is treated as ABANDONED and may be reclaimed.
 *
 * Two minutes is chosen against the longest a handler can legitimately still be running, not against
 * anybody's patience: the pool gives up acquiring a connection after 5 s and every statement is
 * capped at 15 s, so a handler that has held a claim for two minutes is not running any more — the
 * process that owned it died, or its release failed.
 *
 * Reclaiming early would be safe anyway on this endpoint, because the exclusion constraint is what
 * actually prevents a double booking and a second handler would simply lose with a 409. The window
 * exists so that a genuinely slow call is not interrupted, not as the correctness argument.
 */
const STALE_CLAIM_MINUTES = 2;

export interface IdempotentCall {
  key: string;
  /** Namespace, e.g. "booking.create" — keys are scoped per operation. */
  scope: string;
  /** The request body, hashed to detect the same key reused with different input. */
  request: unknown;
}

/**
 * EC-003 — "the customer pressed Pay twice".
 *
 * A replayed request returns the FIRST response rather than performing the operation
 * again. Enforced by a unique primary key in PostgreSQL, not by a cache: a duplicate
 * charge is not a recoverable error, so the guarantee has to survive a cache
 * eviction, a restart, and a request landing on a different replica.
 *
 * The flow is deliberately claim-first: INSERT the key before running the handler.
 * Checking-then-inserting leaves a window where two concurrent requests both see
 * "no record" and both proceed — exactly the double-charge this exists to prevent.
 * Here the second INSERT loses on the unique constraint and never runs the handler.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private readonly log = new Logger(IdempotencyService.name);

  async run<T>(call: IdempotentCall, handler: () => Promise<T>): Promise<T> {
    const requestHash = hashRequest(call.request);
    const expiresAt = new Date(Date.now() + RETENTION_HOURS * 3_600_000);

    // ── Claim the key ───────────────────────────────────────────────────────
    try {
      await this.db.execute(sql`
        INSERT INTO idempotency_keys (key, scope, request_hash, status, expires_at)
        VALUES (${call.key}, ${call.scope}, ${requestHash}, 'in_progress', ${expiresAt})
      `);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      /*
        Someone already claimed it — a completed call to replay, one still running, or one ABANDONED.

        The third case is why this is not simply `replay()`. See `reclaimStale`.
      */
      if (await this.reclaimStale(call, requestHash, expiresAt)) {
        return this.own(call, handler);
      }

      return this.replay<T>(call, requestHash);
    }

    return this.own(call, handler);
  }

  /**
   * Runs the handler exactly once, holding the claim we own.
   *
   * Extracted so the reclaim path above runs the handler by the same route as the first claimant
   * rather than a copy of it.
   */
  private async own<T>(call: IdempotentCall, handler: () => Promise<T>): Promise<T> {
    try {
      const result = await handler();

      await this.db.execute(sql`
        UPDATE idempotency_keys
        SET status = 'completed',
            response_body = ${JSON.stringify(result)}::jsonb,
            response_status = 201
        WHERE key = ${call.key}
      `);

      return result;
    } catch (error) {
      /**
       * The claim is RELEASED on failure, so the customer can legitimately retry.
       *
       * Keeping it would leave them permanently unable to book with that key — a
       * validation error or a transient database blip would look like a dead end.
       * Only a SUCCESSFUL call is worth making non-repeatable.
       *
       * ## Why the release cannot be allowed to throw
       *
       * It was `await this.db.execute(DELETE …); throw error;` with nothing around it, so a release
       * that failed did three things at once: it never reached `throw error`, it replaced the real
       * cause with its own, and it left the claim `in_progress` for the full 24-hour retention.
       *
       * All three happen together, because the reason the release fails is the reason the handler
       * failed. Scenario 2 of the load test hit it 487 times in five minutes on 2026-08-20: the pool
       * was exhausted, so neither the booking nor the release could get a connection, and every one
       * of those responses blamed `DELETE FROM idempotency_keys` for a failure that had nothing to do
       * with it. The customer's retry — the checkout form keeps ONE key per mounted form — then got
       * «الطلب قيد المعالجة» until they thought to reload the page.
       *
       * So: the original error always propagates, and a failed release is logged and left for
       * `reclaimStale` to pick up.
       */
      try {
        await this.db.execute(sql`DELETE FROM idempotency_keys WHERE key = ${call.key}`);
      } catch (releaseError) {
        this.log.error(
          `Could not release idempotency claim for scope ${call.scope}; it will be ` +
            `reclaimable after ${STALE_CLAIM_MINUTES} minutes. ` +
            `Release failed with: ${describeError(releaseError)}`,
        );
      }

      throw error;
    }
  }

  /**
   * Takes over a claim nobody is working on any more.
   *
   * ## Why this is needed at all
   *
   * A claim is released by the handler's own catch block, and that release can fail — see `own`.
   * When it does, the row sits at `in_progress` and `replay` answers every retry with 409
   * «الطلب قيد المعالجة» until `expires_at`, which is TWENTY-FOUR HOURS away. For a customer that is
   * indistinguishable from a booking form that has stopped working.
   *
   * ## Why one UPDATE and not read-then-write
   *
   * The staleness test is inside the statement, so two requests arriving together cannot both
   * conclude the claim is abandoned: PostgreSQL serialises the row update and the second one matches
   * nothing, because the first moved `created_at`. Reading first and updating after is the same
   * check-then-act window the claim-first INSERT exists to avoid.
   *
   * ## The scope is BOTH a predicate and a write
   *
   * A predicate because reclaiming means running THIS caller's handler, and a key that went stale
   * under another operation is not this operation's to take. A write because the row would otherwise
   * keep the old scope while holding the new operation's result — `scope` is stored to say what a key
   * was used for, and a lying column is worse than an absent one.
   *
   * Only one scope exists today (`booking.create`), so neither line changes an outcome yet. They are
   * here because the second one is where this would have gone wrong silently, and because `replay`'s
   * protection against the same mix-up is indirect: the request hash differs between operations, so
   * it answers 422 rather than checking the scope.
   *
   * Returns whether this caller now owns the claim.
   */
  private async reclaimStale(
    call: IdempotentCall,
    requestHash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const taken = await this.db.execute(sql`
      UPDATE idempotency_keys
         SET request_hash = ${requestHash},
             scope        = ${call.scope},
             created_at   = now(),
             expires_at   = ${expiresAt},
             response_body = NULL,
             response_status = NULL
       WHERE key = ${call.key}
         AND scope = ${call.scope}
         AND status = 'in_progress'
         AND created_at < now() - (${STALE_CLAIM_MINUTES} || ' minutes')::interval
      RETURNING key
    `);

    if (taken.rows.length > 0) {
      this.log.warn(
        `Reclaimed an abandoned idempotency claim in scope ${call.scope} after ` +
          `${STALE_CLAIM_MINUTES} minutes.`,
      );
    }

    return taken.rows.length > 0;
  }

  private async replay<T>(call: IdempotentCall, requestHash: string): Promise<T> {
    const rows = await this.db.execute<{
      status: string;
      request_hash: string;
      response_body: unknown;
    }>(sql`
      SELECT status, request_hash, response_body
      FROM idempotency_keys
      WHERE key = ${call.key}
      LIMIT 1
    `);

    const record = rows.rows[0];

    // The row vanished between the failed insert and this read — a concurrent
    // failure released it. Treat as a conflict so the client simply retries.
    if (!record) {
      throw conflict(ERROR.REQUEST_IN_PROGRESS);
    }

    /**
     * Same key, different body. This is a client bug, and silently returning the
     * old response would hide it — the customer might believe they booked the dates
     * they just submitted rather than the earlier ones.
     */
    if (record.request_hash !== requestHash) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        code: ERROR.REQUEST_IDEMPOTENCY_KEY_REUSED,
        message: errorMessage(ERROR.REQUEST_IDEMPOTENCY_KEY_REUSED, 'en'),
      });
    }

    if (record.status === 'in_progress') {
      // Still running. 409 rather than blocking, so the client controls the retry.
      throw conflict(ERROR.REQUEST_STILL_PROCESSING);
    }

    return record.response_body as T;
  }
}

/**
 * Hashes the request so the same key cannot be reused for different input.
 *
 * Keys are sorted before serialising, because `{a:1,b:2}` and `{b:2,a:1}` are the
 * same request and must not produce different hashes.
 */
function hashRequest(request: unknown): string {
  return createHash('sha256').update(stableStringify(request)).digest('base64url');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    // The idempotency key itself is part of the row, not the payload identity.
    .filter(([key]) => key !== 'idempotencyKey')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);

  return `{${entries.join(',')}}`;
}

function isUniqueViolation(error: unknown): boolean {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];

  return candidates.some(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as { code?: unknown }).code === UNIQUE_VIOLATION,
  );
}
