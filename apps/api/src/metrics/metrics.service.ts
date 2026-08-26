import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { EU_SOURCE } from '../sanctions/sanctions.service.js';
import { MediaReachabilityService } from '../storage/media-reachability.service.js';
import { QUEUE } from '../queue/queue.definitions.js';

/**
 * The gauges alerting reads, in Prometheus exposition format.
 *
 * ## Why this exists rather than pointing a scraper at the database
 *
 * Every signal in `docs/alerting.md` is already a row this application writes — job runs,
 * notification deliveries, unprocessed webhooks. A scraper *could* query them directly, and that
 * would mean handing database credentials to the monitoring system and encoding our schema into
 * somebody else's configuration. Two consequences, both bad: a migration silently breaks alerting,
 * and the blast radius of a compromised scraper becomes the whole database.
 *
 * Exposing the derived numbers here keeps the schema an implementation detail and gives the
 * scraper a read-only, PII-free surface.
 *
 * ## What is deliberately NOT here
 *
 * Anything identifying a person. Every series below is a COUNT or an AGE. No email, no reference,
 * no partner name — metrics endpoints are scraped by systems with broad read access and are
 * frequently the least-guarded thing in an estate.
 *
 * Job names appear as labels because they are internal constants, and an alert that cannot say
 * WHICH job stopped is an alert somebody has to go and investigate from scratch.
 *
 * ## The queries are bounded, and each uses an index
 *
 * A metrics endpoint is scraped every fifteen seconds, for ever, on every replica. An unbounded
 * `count(*)` here would be a self-inflicted load test. Every query below is either an index-only
 * lookup of one row or a count over a window bounded by time:
 *
 * - `scheduled_job_runs_job_idx` on `(job, started_at)`
 * - `notifications_status_idx` on `(status, created_at)`
 * - `payment_provider_events_unprocessed_idx`, a PARTIAL index on unprocessed rows
 * - `bookings_sla_idx` on `(status, confirmation_deadline_at)`
 *
 * ## And they are cached
 *
 * Several replicas, each scraped, each running the same seven queries, is seven times the load for
 * one set of answers. A short cache costs at most `CACHE_MS` of staleness on numbers whose alert
 * thresholds are measured in minutes and hours.
 */

/** Long enough to absorb a scrape storm, far shorter than any alert threshold. */
const CACHE_MS = 10_000;

/** The jobs alerting watches by name. Absent from the table means never run, not zero. */
const WATCHED_JOBS = ['payout-accrual', 'ranking-recompute'] as const;

interface Gauge {
  readonly name: string;
  readonly help: string;
  readonly samples: readonly { labels?: Record<string, string>; value: number }[];
}

@Injectable()
export class MetricsService {
  private cached: { at: number; body: string } | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly media: MediaReachabilityService,
  ) {}

  /**
   * Drops the cached body.
   *
   * Exists for tests, which assert a number, change a row and assert it again — inside the cache
   * window, so without this they would read the previous answer and report it as the metric being
   * wrong. `FxRateService.invalidate` is here for the same reason and reads the same way.
   */
  invalidate(): void {
    this.cached = null;
  }

  async expose(): Promise<string> {
    const now = Date.now();

    if (this.cached && now - this.cached.at < CACHE_MS) return this.cached.body;

    const started = process.hrtime.bigint();
    const gauges = await this.collect();
    const elapsed = Number(process.hrtime.bigint() - started) / 1e9;

    const body = render([
      ...gauges,
      {
        name: 'safra_metrics_collection_seconds',
        help: 'Time taken to collect these metrics. Watch it: this endpoint must stay cheap.',
        samples: [{ value: elapsed }],
      },
    ]);

    this.cached = { at: now, body };

    return body;
  }

  private async collect(): Promise<Gauge[]> {
    const [
      jobs,
      notifications,
      sanctions,
      fx,
      webhooks,
      sla,
      deadLetters,
      imagePipeline,
    ] = await Promise.all([
      this.jobs(),
      this.notifications(),
      this.sanctions(),
      this.fx(),
      this.webhooks(),
      this.sla(),
      this.deadLetters(),
      this.imagePipeline(),
    ]);

    return [
      ...jobs,
      ...notifications,
      ...sanctions,
      ...fx,
      ...webhooks,
      ...sla,
      ...deadLetters,
      ...imagePipeline,
      {
        name: 'safra_media_reachable',
        help: '1 when the media bucket answers for a missing object, 0 when it refuses or is unreachable.',
        /* `skipped` is local-disk storage, where there is no bucket policy to get wrong. */
        samples: [
          {
            value:
              this.media.status() === 'ok' || this.media.status() === 'skipped' ? 1 : 0,
          },
        ],
      },
    ];
  }

  /**
   * Alerts 1–3: has each job run, and has it been failing.
   *
   * The AGE of the last success is the signal, not a count of runs — the failure that matters is a
   * job that stopped firing, and a job that stops produces no rows at all. A metric derived from
   * rows that exist can never see it, so the query asks how long it has been instead.
   *
   * A job with no successful run ever reports `-1` rather than being absent. An absent series is
   * indistinguishable from a scrape failure, and this is exactly the case that must not be missed.
   */
  private async jobs(): Promise<Gauge[]> {
    const jobRows = sql.join(
      WATCHED_JOBS.map((job) => sql`(${job})`),
      sql`, `,
    );

    const rows = await this.db.execute<{
      job: string;
      last_success_age: string | null;
      recent_failures: string;
    }>(sql`
      SELECT j.job,
             EXTRACT(EPOCH FROM (now() - (
               SELECT max(r.started_at) FROM scheduled_job_runs r
               WHERE r.job = j.job AND r.status = 'completed'
             )))::text AS last_success_age,
             (
               SELECT count(*) FROM scheduled_job_runs r
               WHERE r.job = j.job AND r.status = 'failed'
                 AND r.started_at > now() - INTERVAL '6 hours'
             )::text AS recent_failures
      -- A parameterised VALUES list, one row per watched job.
      --
      -- Not unnest of an array parameter: drizzle expands a JS array into a positional TUPLE,
      -- which is a syntax error there. And not string interpolation, even though these are internal
      -- constants — a query built by concatenation is one refactor from taking a caller's value.
      FROM (VALUES ${jobRows}) AS j(job)
    `);

    return [
      {
        name: 'safra_job_last_success_age_seconds',
        help: 'Seconds since this job last completed. -1 means it has never completed.',
        samples: rows.rows.map((row) => ({
          labels: { job: row.job },
          value: row.last_success_age === null ? -1 : Number(row.last_success_age),
        })),
      },
      {
        name: 'safra_job_failures_6h',
        help: 'Failed runs of this job in the last six hours.',
        samples: rows.rows.map((row) => ({
          labels: { job: row.job },
          value: Number(row.recent_failures),
        })),
      },
    ];
  }

  /**
   * Alerts 4–5: are notices being delivered, and are they being sent at all.
   *
   * Both halves are needed and they fail differently. A high failure ratio means the mail path is
   * broken; ZERO notifications for hours means the calling code stopped enqueueing, which produces
   * no failures either and is invisible to a ratio.
   */
  private async notifications(): Promise<Gauge[]> {
    const rows = await this.db.execute<{
      sent: string;
      failed: string;
      queued: string;
    }>(sql`
      SELECT count(*) FILTER (WHERE status = 'sent')::text   AS sent,
             count(*) FILTER (WHERE status = 'failed')::text AS failed,
             count(*) FILTER (WHERE status = 'queued')::text AS queued
      FROM notifications
      WHERE created_at > now() - INTERVAL '1 hour'
    `);

    const row = rows.rows[0];

    return [
      {
        name: 'safra_notifications_1h',
        help: 'Notification sends in the last hour, by outcome.',
        samples: [
          { labels: { status: 'sent' }, value: Number(row?.sent ?? 0) },
          { labels: { status: 'failed' }, value: Number(row?.failed ?? 0) },
          /*
            A row stuck at `queued` means the process died between writing it and finishing the
            send. Nothing retries today, so this is the count of notices nobody will ever receive.
          */
          { labels: { status: 'queued' }, value: Number(row?.queued ?? 0) },
        ],
      },
    ];
  }

  /**
   * Alert 6: the sanctions data we screen against is only as good as its age.
   *
   * ## `eu_consolidated` is ALWAYS a series, at -1 when it does not exist
   *
   * The metric used to report one series per source that happened to be present, and a single
   * `{source="none"} -1` when the table was empty. That was correct while `eu_consolidated` was
   * the only source a snapshot could have. It stopped being correct on 2026-08-20, when a
   * development fixture became importable as `local_fixture`: with a fixture loaded and no EU
   * list, the table is NOT empty, so the `none` series disappears — and the fixture reports an age
   * of about zero. Alert 6 goes quiet, on a platform that cannot screen anybody.
   *
   * A fixture cannot exist in production, so this was never a production hole. It is worse than
   * that in kind: a monitoring signal that reads healthy in the one environment where somebody is
   * developing against it teaches the wrong thing about what the signal means.
   *
   * So the obliged source is reported unconditionally, and every other source is reported
   * alongside it as information. `{source="none"}` is gone: it existed to answer "is the table
   * empty", and the question the alert actually has is "do we hold a current EU list", which the
   * EU series now answers on its own.
   */
  private async sanctions(): Promise<Gauge[]> {
    const rows = await this.db.execute<{ source: string; age: string }>(sql`
      SELECT source, EXTRACT(EPOCH FROM (now() - max(fetched_at)))::text AS age
      FROM sanctions_snapshots
      GROUP BY source
    `);

    const samples = rows.rows.map((row) => ({
      labels: { source: row.source },
      value: Number(row.age),
    }));

    /*
      -1 rather than an omitted series, for the reason the rest of this file gives: an absent
      series is indistinguishable from a failed scrape, and "we have never fetched the list we are
      legally obliged to screen against" must not look like a monitoring outage.
    */
    if (!samples.some((sample) => sample.labels.source === EU_SOURCE)) {
      samples.unshift({ labels: { source: EU_SOURCE }, value: -1 });
    }

    return [
      {
        name: 'safra_sanctions_snapshot_age_seconds',
        help: 'Seconds since this sanctions source was last fetched. -1 means never.',
        samples,
      },
    ];
  }

  /**
   * The FX rates every cross-currency movement depends on — how old, and how many are missing.
   *
   * ## Why this exists at all
   *
   * `FxRateService` already refuses to price on a rate it does not have, rather than defaulting to
   * 1 — which is right, and which is exactly why the absence has to be visible somewhere other
   * than an exception. On 2026-08-26 three of the five active currencies had NO rate to SYP and
   * the fourth was fifteen days old, and nothing anywhere reported that: the only signal was a
   * throttled log line and a 503 reaching whoever happened to try.
   *
   * A wallet is denominated in one currency forever, so a credit arriving in another is converted
   * through SYP. No rate means the conversion refuses, which means a compensation, a refund to a
   * wallet, or a gift card redeemed across currencies cannot complete. 512 of the 11,801 wallets
   * are EUR, and EUR is one of the three.
   *
   * ## `-1` for a currency with no rate, never an omitted series
   *
   * The same argument the sanctions gauge makes above: an absent series is indistinguishable from
   * a failed scrape, and "we hold no rate for this currency at all" must not look like a
   * monitoring outage. Every ACTIVE currency reports, whether or not a rate exists.
   *
   * SYP itself is excluded — it is the quote currency, and a SYP→SYP rate is not a thing anybody
   * configures. Including it would report a permanent -1 that nobody can ever clear, which is how
   * an alert gets muted and stays muted.
   */
  private async fx(): Promise<Gauge[]> {
    const rows = await this.db.execute<{ currency: string; age: string | null }>(sql`
      SELECT c.code AS currency,
             EXTRACT(EPOCH FROM (now() - max(f.effective_from)))::text AS age
      FROM currencies c
      LEFT JOIN fx_rates f
        ON f.base_currency_id = c.id
       AND f.quote_currency_id = (SELECT id FROM currencies WHERE code = 'SYP')
       AND f.effective_from <= now()
      WHERE c.is_active AND c.code <> 'SYP'
      GROUP BY c.code
      ORDER BY c.code
    `);

    const samples = rows.rows.map((row) => ({
      labels: { currency: row.currency },
      value: row.age === null ? -1 : Number(row.age),
    }));

    return [
      {
        name: 'safra_fx_rate_age_seconds',
        help: 'Seconds since this currency\u2019s rate to SYP took effect. -1 means no rate exists.',
        samples,
      },
      {
        name: 'safra_fx_currencies_without_rate',
        help: 'Active currencies, SYP excluded, holding no rate to SYP. Every conversion into or out of one of these refuses.',
        samples: [{ labels: {}, value: samples.filter((s) => s.value === -1).length }],
      },
    ];
  }

  /**
   * Alert 14: money captured, booking not advanced. And alert 14b: somebody is sending us rubbish.
   *
   * ## Why the backlog excludes rejected events
   *
   * `processed_at IS NULL` looks like "waiting to be processed" and is not. A webhook whose
   * signature failed, or whose body could not be parsed, is stored deliberately for forensics with
   * `event_type = 'unparsed'`, and it can NEVER be processed — there is nothing to act on. Those
   * rows stay `processed_at IS NULL` until `WebhookRetentionService` prunes them after 30 days.
   *
   * Counting them as backlog meant alert 14 — severity PAGE, threshold 15 minutes — fired
   * permanently the first time any environment received one malformed request, and could not be
   * cleared for a month. The development database was 8.8 days into exactly that when this was
   * found (2026-08-13): 219 "unprocessed" events, 204 of them permanently unprocessable.
   *
   * An alert that is always firing is an alert nobody reads, and the first page on-call receives
   * being an unclearable false positive is how monitoring gets switched off.
   *
   * ## So they are counted SEPARATELY, because a flood of them matters too
   *
   * A burst of rejected webhooks is a forged-signature attempt or a provider changing their payload
   * format. Both are worth knowing, and neither is "a paid booking did not advance". Different
   * meaning, different gauge, different alert shape: a RATE over 24 hours rather than a backlog age.
   */
  private async webhooks(): Promise<Gauge[]> {
    /*
      The predicate for "genuinely waiting": parseable, signed, and not yet acted on. It must stay in
      step with the rejected predicate below — between them they should cover every unprocessed row,
      or an event could be invisible to both gauges.
    */
    const rows = await this.db.execute<{
      n: string;
      oldest: string | null;
      rejected: string;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE signature_verified AND event_type <> 'unparsed')::text AS n,
        EXTRACT(EPOCH FROM (now() - min(created_at)
          FILTER (WHERE signature_verified AND event_type <> 'unparsed')))::text AS oldest,
        count(*) FILTER (
          WHERE (NOT signature_verified OR event_type = 'unparsed')
            AND created_at >= now() - interval '24 hours'
        )::text AS rejected
      FROM payment_provider_events
      -- Both gauges live inside the unprocessed set, so the shared predicate is a WHERE and the
      -- split is a FILTER. Written the other way round — three FILTERs over the whole table — this
      -- became a SEQ SCAN, on an endpoint scraped every fifteen seconds on every replica, over a
      -- table that grows with every webhook ever received. payment_provider_events_unprocessed_idx
      -- is (created_at) WHERE processed_at IS NULL, and this is what reaches it.
      --
      -- A rejected event is never processed, so bounding rejections by this predicate loses none of
      -- them; retention prunes them at 30 days, far outside the 24-hour window counted here.
      WHERE processed_at IS NULL
    `);

    const row = rows.rows[0];

    return [
      {
        name: 'safra_payment_events_unprocessed',
        help:
          'Payment provider events awaiting processing. Excludes events that were rejected on ' +
          'arrival and can never be processed — see safra_payment_events_rejected_24h.',
        samples: [{ value: Number(row?.n ?? 0) }],
      },
      {
        name: 'safra_payment_events_oldest_unprocessed_seconds',
        help: 'Age of the oldest event awaiting processing. 0 when there are none.',
        samples: [{ value: row?.oldest === null ? 0 : Number(row?.oldest ?? 0) }],
      },
      {
        name: 'safra_payment_events_rejected_24h',
        help:
          'Webhooks rejected on arrival in the last 24 hours — bad signature or unparseable body. ' +
          'A burst means a forgery attempt or a provider changing their payload format.',
        samples: [{ value: Number(row?.rejected ?? 0) }],
      },
    ];
  }

  /**
   * Alert 15: the SLA sweep is not running.
   *
   * A booking past its confirmation deadline and still `pending_confirmation` is a customer owed a
   * refund and compensation under §6.4 who is not getting either. The sweep failing is invisible
   * from the sweep's own side — it simply does not run — so this counts the CONSEQUENCE instead.
   */
  /**
   * Jobs that exhausted every retry and are waiting for a person.
   *
   * ## Why the TABLE and not the queue
   *
   * `docs/background-jobs-design.md`: alert on the table, not on Redis. Two reasons, and the second
   * is the important one. A Redis gauge needs the scraper to reach Redis, which means a second
   * credential and a second thing to be down. And a dead letter is precisely the evidence that must
   * survive a Redis failure — asking Redis how many jobs it lost is asking the wrong process.
   *
   * ## Outstanding, not total
   *
   * A dead letter that somebody has retried or discarded is history. Counting it would leave the
   * alert firing after the work was done, which is how a page becomes something people silence.
   * Served by `dead_letter_jobs_outstanding_idx`, which is partial on exactly this predicate.
   */
  private async deadLetters(): Promise<Gauge[]> {
    const rows = await this.db.execute<{
      queue: string;
      n: string;
      oldest: string | null;
    }>(sql`
      SELECT queue, count(*)::text AS n,
             EXTRACT(EPOCH FROM (now() - min(failed_at)))::text AS oldest
      FROM dead_letter_jobs
      WHERE resolved_at IS NULL
      GROUP BY queue
    `);

    /*
      Zero is reported explicitly for every known queue rather than omitted.

      An absent series is indistinguishable from a failed scrape, which is the same reasoning
      `safra_job_last_success_age_seconds` uses for -1: the case that must never be missed is the one
      where the signal is silent.
    */
    const byQueue = new Map(rows.rows.map((row) => [row.queue, row]));

    return [
      {
        name: 'safra_dead_letter_jobs',
        help: 'Jobs that exhausted every retry and nobody has retried or discarded yet.',
        samples: Object.values(QUEUE).map((queue) => ({
          labels: { queue },
          value: Number(byQueue.get(queue)?.n ?? 0),
        })),
      },
      {
        name: 'safra_dead_letter_oldest_seconds',
        help: 'Age of the oldest unresolved dead letter. 0 when there are none.',
        samples: Object.values(QUEUE).map((queue) => ({
          labels: { queue },
          value: Number(byQueue.get(queue)?.oldest ?? 0),
        })),
      },
    ];
  }

  /**
   * Photographs that were accepted and never rendered.
   *
   * ## Why this is a separate signal from the dead letters
   *
   * A dead letter means a job ran, failed every attempt, and said so. This counts the case with no
   * job at all: `notify`-style enqueue swallowing means an upload whose `media.add` threw leaves a
   * `processing` row and NOTHING in Redis, and so does a worker that is simply not running. Both are
   * silent — the partner sees a tile that never finishes, and no alert fires, because from the
   * queue's point of view nothing ever went wrong.
   *
   * ## Why it is an age and not a count
   *
   * A count is meaningless without knowing how long: at any instant several images are legitimately
   * mid-render. The oldest one's age is the signal — under a minute is a working pipeline, an hour
   * is a stopped worker. Zero when the queue is empty, which is the ordinary state.
   *
   * The partial index `property_images_processing_idx` is what makes this cheap enough to run on
   * every scrape of an ever-growing table.
   */
  /*
    Not `media()` — that name is taken by the injected `MediaReachabilityService` field, and a
    method and a property of the same name on one class is a silent shadow rather than an error in
    some positions. The same clash cost time in `MessagingService` (`notifications`), which is why
    this one is named for what it measures instead.
  */
  private async imagePipeline(): Promise<Gauge[]> {
    const rows = await this.db.execute<{ n: string; oldest: string | null }>(sql`
      SELECT count(*)::text AS n,
             EXTRACT(EPOCH FROM (now() - min(updated_at)))::text AS oldest
      FROM property_images
      WHERE status = 'processing'
    `);

    const row = rows.rows[0];

    return [
      {
        name: 'safra_images_processing',
        help: 'Uploaded photographs waiting for a worker to render their variants.',
        samples: [{ labels: {}, value: Number(row?.n ?? 0) }],
      },
      {
        name: 'safra_images_processing_oldest_seconds',
        help: 'Age of the longest-waiting unrendered photograph. 0 when none are waiting.',
        samples: [{ labels: {}, value: Number(row?.oldest ?? 0) }],
      },
    ];
  }

  private async sla(): Promise<Gauge[]> {
    const rows = await this.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n
      FROM bookings
      WHERE status = 'pending_confirmation'
        AND confirmation_deadline_at IS NOT NULL
        AND confirmation_deadline_at < now() - INTERVAL '15 minutes'
    `);

    return [
      {
        name: 'safra_bookings_sla_overdue',
        help: 'Bookings past their confirmation deadline that the SLA sweep has not resolved.',
        samples: [{ value: Number(rows.rows[0]?.n ?? 0) }],
      },
    ];
  }
}

/**
 * Prometheus text exposition, version 0.0.4.
 *
 * Hand-written rather than pulled from `prom-client`: what is produced here is a handful of gauges
 * with no histograms, no default process collectors and no registry to keep in step. The library
 * would add a dependency, a global singleton and its own opinions about process metrics, in
 * exchange for formatting three lines.
 */
function render(gauges: readonly Gauge[]): string {
  const lines: string[] = [];

  for (const gauge of gauges) {
    lines.push(`# HELP ${gauge.name} ${gauge.help}`);
    lines.push(`# TYPE ${gauge.name} gauge`);

    for (const sample of gauge.samples) {
      /*
        No braces at all when there are no labels.

        `{}` is legal exposition and every strict parser accepts it, but the canonical form is the
        bare name, and it is what a series keyed by name in a query or a test actually matches.
        Four gauges here already passed an empty object and rendered `safra_images_processing{} 3`
        while `safra_metrics_collection_seconds` rendered bare — same table, two spellings.
        Prometheus treats them as the SAME series, so this changes no dashboard.
      */
      const pairs = Object.entries(sample.labels ?? {});

      const labels =
        pairs.length > 0
          ? `{${pairs.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(',')}}`
          : '';

      lines.push(`${gauge.name}${labels} ${sample.value}`);
    }
  }

  /* The format requires a trailing newline; a scraper rejects the last line without it. */
  return `${lines.join('\n')}\n`;
}

/** Label values are quoted, so a backslash, quote or newline in one would break the parse. */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
