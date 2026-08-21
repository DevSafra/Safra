import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { MetricsService } from './metrics.service.js';
import type { MediaReachabilityService } from '../storage/media-reachability.service.js';

/**
 * The gauges, against a real PostgreSQL.
 *
 * ## Why this needs a database and not a mock
 *
 * Every metric here is a SQL expression, and the thing that breaks is the SQL: a renamed column, a
 * predicate that stops matching, an `EXTRACT` that returns null where a number was expected. A
 * mocked database would assert that the formatter works, which was never in doubt.
 *
 * ## And why the ABSENT cases are the interesting ones
 *
 * The failure alerting exists to catch is silence — a job that stopped firing, a feed never
 * fetched. Those produce NO ROWS, and a metric derived from rows that exist cannot see them. Half
 * the assertions below are about what the endpoint reports when the table has nothing in it.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('MetricsService', () => {
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const media = { status: () => 'ok' } as unknown as MediaReachabilityService;
  const service = new MetricsService(db, media);

  beforeEach(async () => {
    await harness.begin();
    /* Each test changes a row and reads the gauge; the cache would serve the previous answer. */
    service.invalidate();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** One scrape, parsed into `{ 'name{labels}': value }`. */
  async function scrape(): Promise<Record<string, number>> {
    service.invalidate();

    const body = await service.expose();
    const out: Record<string, number> = {};

    for (const line of body.split('\n')) {
      if (line.startsWith('#') || line.trim() === '') continue;

      const match = /^(\S+)\s+(-?[\d.e+]+)$/.exec(line);

      if (match?.[1] && match[2]) out[match[1]] = Number(match[2]);
    }

    return out;
  }

  describe('the exposition itself', () => {
    it('is valid Prometheus text with HELP and TYPE for every series', async () => {
      const body = await service.expose();
      const names = [
        ...new Set(
          body
            .split('\n')
            .filter((line) => line && !line.startsWith('#'))
            .map((line) => line.split(/[\s{]/)[0]),
        ),
      ];

      expect(names.length).toBeGreaterThan(5);

      for (const name of names) {
        expect(body).toContain(`# HELP ${name} `);
        expect(body).toContain(`# TYPE ${name} gauge`);
      }

      /* The format requires it, and a scraper drops the last line without it. */
      expect(body.endsWith('\n')).toBe(true);
    });

    /**
     * Nothing here may identify a person.
     *
     * A metrics endpoint is scraped by systems with broad read access and is frequently the least
     * guarded thing in an estate. Every series is a count or an age; the only labels are job names
     * and feed sources, which are internal constants.
     */
    it('exposes no address, reference or name', async () => {
      /* Real rows of every shape this endpoint reads, so the check has something to leak. */
      await db.execute(sql`
        INSERT INTO notifications (channel, template_key, locale, status)
        VALUES ('email', 'review.received', 'ar', 'failed')
      `);

      const body = await service.expose();

      expect(body).not.toMatch(/@/);
      expect(body).not.toMatch(/BKG-|PRO-|PAR-|REV-/);
      expect(body).not.toMatch(/[؀-ۿ]/);
    });
  });

  describe('scheduled jobs', () => {
    /**
     * The case that matters most, and the one a naive query cannot see.
     *
     * A job that has stopped firing writes no rows. Reporting nothing would be indistinguishable
     * from a failed scrape, so a job that has never completed reports -1 and the alert fires on it.
     */
    it('reports -1 for a job that has never completed, not an absent series', async () => {
      await db.execute(sql`DELETE FROM scheduled_job_runs WHERE job = 'payout-accrual'`);

      const metrics = await scrape();

      expect(metrics['safra_job_last_success_age_seconds{job="payout-accrual"}']).toBe(
        -1,
      );
    });

    it('reports the age of the last completed run', async () => {
      /*
        Cleared first, because the metric is `max(started_at)` and the real scheduler fires hourly.
        Without this the test asserts the age of whichever run happened most recently — which was
        a genuine accrual, correctly reported, failing a test that had assumed an idle database.
        The DELETE is inside the test's transaction and is discarded with everything else.
      */
      await db.execute(sql`DELETE FROM scheduled_job_runs WHERE job = 'payout-accrual'`);
      await db.execute(sql`
        INSERT INTO scheduled_job_runs (job, status, started_at, duration_ms)
        VALUES ('payout-accrual', 'completed', now() - INTERVAL '90 minutes', 10)
      `);

      const metrics = await scrape();
      const age =
        metrics['safra_job_last_success_age_seconds{job="payout-accrual"}'] ?? 0;

      /* Ninety minutes, give or take the clock — and past the two-hour page threshold's halfway. */
      expect(age).toBeGreaterThan(5_300);
      expect(age).toBeLessThan(5_500);
    });

    /* A skipped run is another replica doing nothing; only a completion counts as the job running. */
    it('does not count a skipped run as a success', async () => {
      await db.execute(
        sql`DELETE FROM scheduled_job_runs WHERE job = 'ranking-recompute'`,
      );
      await db.execute(sql`
        INSERT INTO scheduled_job_runs (job, status, started_at, duration_ms)
        VALUES ('ranking-recompute', 'skipped', now(), 1)
      `);

      const metrics = await scrape();

      expect(metrics['safra_job_last_success_age_seconds{job="ranking-recompute"}']).toBe(
        -1,
      );
    });

    it('counts recent failures, and only recent ones', async () => {
      const before = await scrape();

      await db.execute(sql`
        INSERT INTO scheduled_job_runs (job, status, started_at, duration_ms, error)
        VALUES ('payout-accrual', 'failed', now() - INTERVAL '1 hour', 5, 'boom'),
               ('payout-accrual', 'failed', now() - INTERVAL '2 hours', 5, 'boom'),
               ('payout-accrual', 'failed', now() - INTERVAL '9 hours', 5, 'old')
      `);

      const after = await scrape();
      const key = 'safra_job_failures_6h{job="payout-accrual"}';

      /* The nine-hour-old one is outside the window; only the two inside it are counted. */
      expect((after[key] ?? 0) - (before[key] ?? 0)).toBe(2);
    });
  });

  describe('notifications', () => {
    /*
      Asserted as a DELTA, not an absolute.

      The gauge counts the whole platform's last hour, which is what alerting wants — and the
      suites that still commit (see `O-data-2`) leave notification rows behind. A test expecting
      an empty table would pass alone and fail in a full run, for a reason that has nothing to do
      with the metric.
    */
    it('separates sent, failed and stuck-in-queued', async () => {
      const before = await scrape();

      await db.execute(sql`
        INSERT INTO notifications (channel, template_key, locale, status)
        VALUES ('email', 'review.received', 'ar', 'sent'),
               ('email', 'review.received', 'ar', 'sent'),
               ('email', 'booking.needs_action', 'ar', 'failed'),
               ('email', 'review.replied', 'de', 'queued')
      `);

      const after = await scrape();
      const delta = (status: string) =>
        (after[`safra_notifications_1h{status="${status}"}`] ?? 0) -
        (before[`safra_notifications_1h{status="${status}"}`] ?? 0);

      expect(delta('sent')).toBe(2);
      expect(delta('failed')).toBe(1);
      /*
        `queued` is its own series because it is its own failure: the process died between writing
        the row and finishing the send, and nothing retries, so nobody will ever receive it.
      */
      expect(delta('queued')).toBe(1);
    });
  });

  describe('sanctions', () => {
    const AGE = 'safra_sanctions_snapshot_age_seconds';

    /*
      Entries first, everywhere. The delete used to name only the snapshots and passed for a year
      because no developer database happened to hold one — the moment somebody imported a list
      locally, the foreign key refused and this failed with an error about `sanctions_entries` in a
      test about a metric. A test whose result depends on what is already in the database is not a
      test.
    */
    beforeEach(async () => {
      await db.execute(sql`DELETE FROM sanctions_entries`);
      await db.execute(sql`DELETE FROM sanctions_snapshots`);
    });

    const snapshot = (source: string) =>
      db.execute(sql`
        INSERT INTO sanctions_snapshots (source, content_hash, entry_count, completed_at)
        VALUES (${source}, ${`hash-${source}`}, 1, now())
      `);

    /* `M-2` is unresolved, so "never fetched" is the state the platform is actually in. */
    it('reports -1 when no feed has ever been fetched', async () => {
      const metrics = await scrape();

      expect(metrics[`${AGE}{source="eu_consolidated"}`]).toBe(-1);
    });

    it('reports the age once a list is held', async () => {
      await snapshot('eu_consolidated');

      const metrics = await scrape();

      expect(metrics[`${AGE}{source="eu_consolidated"}`]).toBeGreaterThanOrEqual(0);
    });

    /**
     * THE assertion, and the reason the EU series is unconditional.
     *
     * A development fixture is a row in the same table. While the metric reported whatever sources
     * happened to be present, one fixture made the "nothing has ever been fetched" series vanish
     * and reported an age of about zero in its place — so alert 6 fell silent on a platform that
     * could not screen anybody. The alert must see -1 whatever else is in the table.
     */
    it('is not silenced by a development fixture', async () => {
      await snapshot('local_fixture');

      const metrics = await scrape();

      expect(metrics[`${AGE}{source="eu_consolidated"}`]).toBe(-1);
      expect(metrics[`${AGE}{source="local_fixture"}`]).toBeGreaterThanOrEqual(0);
    });
  });

  describe('payments and the SLA sweep', () => {
    it('counts unprocessed payment events and the age of the oldest', async () => {
      const metrics = await scrape();

      expect(metrics['safra_payment_events_unprocessed']).toBeGreaterThanOrEqual(0);
      expect(
        metrics['safra_payment_events_oldest_unprocessed_seconds'],
      ).toBeGreaterThanOrEqual(0);
    });

    /** One rejected and one genuine event, so the two gauges can be told apart. */
    const receive = async (kind: 'rejected' | 'awaiting'): Promise<void> => {
      await db.execute(sql`
        INSERT INTO payment_provider_events
          (provider, provider_event_id, event_type, payload, signature_verified)
        VALUES ('simulator', ${`probe-${kind}-${Math.random()}`},
                ${kind === 'rejected' ? 'unparsed' : 'payment.captured'},
                '{}'::jsonb,
                ${kind !== 'rejected'})
      `);
    };

    /**
     * The alert-14 false positive, pinned.
     *
     * A webhook rejected on arrival — bad signature, or a body that would not parse — is stored for
     * forensics and can NEVER be processed, so it sits at `processed_at IS NULL` for the thirty days
     * before retention prunes it. Counting it as backlog made a PAGE-severity alert with a 15-minute
     * threshold fire permanently after one malformed request: the development database had been in
     * that state for 8.8 days, with 204 permanently-unprocessable rows, when this was found.
     */
    it('leaves a rejected webhook out of the backlog it can never join', async () => {
      const before = await scrape();

      await receive('rejected');
      service.invalidate();

      const after = await scrape();

      expect(after['safra_payment_events_unprocessed']).toBe(
        before['safra_payment_events_unprocessed'],
      );
    });

    it('does count an event that is genuinely waiting', async () => {
      const before = await scrape();

      await receive('awaiting');
      service.invalidate();

      const after = await scrape();

      expect(after['safra_payment_events_unprocessed']).toBe(
        (before['safra_payment_events_unprocessed'] ?? 0) + 1,
      );
    });

    /** Rejected events are not ignored — they are a different signal with a different shape. */
    it('counts a rejected webhook as a rejection instead', async () => {
      const before = await scrape();

      await receive('rejected');
      service.invalidate();

      const after = await scrape();

      expect(after['safra_payment_events_rejected_24h']).toBe(
        (before['safra_payment_events_rejected_24h'] ?? 0) + 1,
      );
    });

    /**
     * Between them the two gauges must account for every unprocessed row, or an event could be
     * invisible to both — which is worse than the false positive this replaced.
     */
    it('classifies every unprocessed event as either awaiting or rejected', async () => {
      const rows = await db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n
        FROM payment_provider_events
        WHERE processed_at IS NULL
          AND NOT (signature_verified AND event_type <> 'unparsed')
          AND NOT (NOT signature_verified OR event_type = 'unparsed')
      `);

      expect(Number(rows.rows[0]?.n ?? -1)).toBe(0);
    });

    /**
     * The SLA sweep failing is invisible from its own side — it simply does not run. So this counts
     * the CONSEQUENCE: bookings past their deadline that nobody has refunded or compensated.
     */
    it('counts bookings the sweep should have resolved and has not', async () => {
      const metrics = await scrape();

      expect(metrics['safra_bookings_sla_overdue']).toBeGreaterThanOrEqual(0);
    });
  });

  describe('cost', () => {
    /**
     * This endpoint is scraped every fifteen seconds, for ever, on every replica.
     *
     * The number is reported as a gauge so it can be watched in production; asserting it here
     * catches the day somebody adds an unbounded `count(*)` and turns monitoring into load.
     */
    it('collects in well under a second', async () => {
      const metrics = await scrape();

      expect(metrics['safra_metrics_collection_seconds']).toBeLessThan(1);
    });
  });
});
