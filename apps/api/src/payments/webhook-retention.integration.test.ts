import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { WebhookRetentionService } from './webhook-retention.service.js';

/**
 * Webhook retention against a REAL PostgreSQL.
 *
 * The webhook endpoint is `@Public()` by necessity and answers `200` even for an
 * invalid signature, so an unauthenticated caller can write rows at will. Nothing
 * removed them: routine probing on 2026-08-02 left 1,208 rows behind, and sustained
 * abuse has no ceiling.
 *
 * The property that matters is the boundary — unverified noise goes, verified
 * financial evidence stays. Deleting the wrong side of that line would destroy the
 * record proving a provider said a payment was captured.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('WebhookRetentionService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  const db: Database = harness.db;
  const service = new WebhookRetentionService(db);

  /** Namespaced so a run cannot touch rows belonging to any other suite. */
  const TAG = `retention-test-${process.pid}`;

  async function insert(options: {
    id: string;
    verified: boolean;
    processed: boolean;
    ageDays: number;
  }): Promise<void> {
    await db.execute(sql`
      INSERT INTO payment_provider_events
        (provider, provider_event_id, event_type, payload, signature_verified,
         processed_at, created_at)
      VALUES ('simulator', ${`${TAG}-${options.id}`}, 'payment.captured',
              '{}'::jsonb, ${options.verified},
              ${options.processed ? sql`now()` : sql`NULL`},
              now() - ${`${options.ageDays} days`}::interval)
    `);
  }

  async function survives(id: string): Promise<boolean> {
    const rows = await db.execute(sql`
      SELECT 1 FROM payment_provider_events
      WHERE provider_event_id = ${`${TAG}-${id}`}
    `);

    return rows.rows.length > 0;
  }

  /**
   * Cleanup can only remove what the trigger permits — which is the point of the
   * trigger, and means the rows this suite deliberately creates as EVIDENCE are
   * permanent. That is correct behaviour, not a leak: they are namespaced by pid so
   * they cannot collide with another run, and the production table treats them
   * exactly as it treats a real verified webhook.
   *
   * Ages the deletable rows past the window first, so a re-run starts clean.
   */
  async function cleanup(): Promise<void> {
    await db
      .execute(
        sql`
      UPDATE payment_provider_events
      SET processed_at = NULL
      WHERE provider_event_id LIKE ${`${TAG}-%`}
        AND signature_verified = false
        AND processed_at IS NOT NULL
    `,
      )
      .catch(() => undefined);

    await db.execute(sql`
      DELETE FROM payment_provider_events
      WHERE provider_event_id LIKE ${`${TAG}-%`}
        AND signature_verified = false
        AND processed_at IS NULL
        AND created_at < now() - interval '30 days'
    `);
  }

  beforeEach(async () => {
    await harness.begin();
    await cleanup();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** The trigger must refuse a direct delete of evidence, not merely the service. */
  it('the database itself refuses to delete a verified payload', async () => {
    await insert({ id: 'protected', verified: true, processed: true, ageDays: 3650 });

    await expect(
      db.execute(sql`
        DELETE FROM payment_provider_events
        WHERE provider_event_id = ${`${TAG}-protected`}
      `),
    ).rejects.toSatisfy((error: unknown) => {
      const cause = (error as { cause?: unknown }).cause;
      return /This row is evidence/i.test(
        cause instanceof Error ? cause.message : String(error),
      );
    });
  });

  it('removes unverified payloads past the retention window', async () => {
    await insert({ id: 'old-noise', verified: false, processed: false, ageDays: 40 });

    await service.pruneUnverified();

    expect(await survives('old-noise')).toBe(false);
  });

  /** A recent unverified payload is still evidence for an incident in progress. */
  it('keeps unverified payloads inside the window', async () => {
    await insert({ id: 'recent-noise', verified: false, processed: false, ageDays: 3 });

    await service.pruneUnverified();

    expect(await survives('recent-noise')).toBe(true);
  });

  /**
   * THE line that must not move. A verified event is the evidence a provider said a
   * payment was captured, and the reason a ledger entry exists. Age is irrelevant;
   * financial retention governs these, not this job.
   */
  it('never removes a verified payload, however old', async () => {
    await insert({ id: 'old-real', verified: true, processed: true, ageDays: 3650 });

    await service.pruneUnverified();

    expect(await survives('old-real')).toBe(true);
  });

  /**
   * An unverified event that was nonetheless processed is an anomaly worth keeping —
   * it means something acted on a payload it should not have, which is exactly what
   * an investigation would need.
   */
  it('never removes an unverified payload that was processed', async () => {
    await insert({ id: 'old-anomaly', verified: false, processed: true, ageDays: 400 });

    await service.pruneUnverified();

    expect(await survives('old-anomaly')).toBe(true);
  });

  it('reports how many it removed', async () => {
    await insert({ id: 'n1', verified: false, processed: false, ageDays: 40 });
    await insert({ id: 'n2', verified: false, processed: false, ageDays: 90 });

    expect(await service.pruneUnverified()).toBeGreaterThanOrEqual(2);
  });

  it('is safe to run when there is nothing to prune', async () => {
    await expect(service.pruneUnverified()).resolves.toBeGreaterThanOrEqual(0);
  });
});
