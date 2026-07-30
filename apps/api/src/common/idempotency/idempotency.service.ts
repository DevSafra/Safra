import { createHash } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../../database/database.module.js';

/** How long a completed response is replayable. */
const RETENTION_HOURS = 24;

/** PostgreSQL's unique-violation code. */
const UNIQUE_VIOLATION = '23505';

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

      // Someone already claimed it — either a completed call to replay, or one still
      // running.
      return this.replay<T>(call, requestHash);
    }

    // ── We own the key; run the handler exactly once ─────────────────────────
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
       */
      await this.db.execute(sql`DELETE FROM idempotency_keys WHERE key = ${call.key}`);
      throw error;
    }
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
      throw new ConflictException(
        'That request is already being processed. Please retry.',
      );
    }

    /**
     * Same key, different body. This is a client bug, and silently returning the
     * old response would hide it — the customer might believe they booked the dates
     * they just submitted rather than the earlier ones.
     */
    if (record.request_hash !== requestHash) {
      throw new UnprocessableEntityException(
        'This idempotency key was already used with a different request.',
      );
    }

    if (record.status === 'in_progress') {
      // Still running. 409 rather than blocking, so the client controls the retry.
      throw new ConflictException(
        'That request is still being processed. Please retry shortly.',
      );
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
