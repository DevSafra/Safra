import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import type { Role } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { ERROR } from '@safra/contracts';
import { badRequest, unavailable } from '../common/errors/app-error.js';

/** SYP is the accounting currency, so its rate against itself is definitionally 1. */
const ACCOUNTING_CURRENCY = 'SYP';

/**
 * How long a looked-up rate is reused.
 *
 * Short, because this now sits in the booking hot path and a query per quote is
 * waste (§3). Only SUCCESSFUL lookups are cached: caching a miss would make an
 * admin who has just set the first rate wait for a TTL before the platform starts
 * pricing, and the miss path is failing anyway so its cost does not matter.
 */
const CACHE_TTL_MS = 60_000;

/**
 * When a rate starts being suspicious. SYP has moved fast enough in recent years
 * that a two-day-old rate is worth flagging.
 */
const STALE_AFTER_HOURS = 48;

/** Throttle for the staleness warning, so a busy day cannot flood the log. */
const STALE_WARN_INTERVAL_MS = 600_000;

interface CachedRate {
  rate: string;
  effectiveFrom: Date;
  expiresAt: number;
}

export interface FxRateRecord {
  currency: string;
  rate: string;
  effectiveFrom: string;
  source: string;
  ageHours: number;
  stale: boolean;
}

/**
 * FX rates to SYP (SRS §1.4).
 *
 * **Refuses to invent a rate.** This replaced a silent `?? '1'` fallback, which was a
 * real defect: with `fx_rates` empty — the state of every fresh install — a $220
 * booking recorded `total_syp = 220`, understating it by roughly four orders of
 * magnitude. Nothing failed, nothing warned, and every SYP figure in the ledger and
 * in §1.4's display was wrong. A missing rate is now a loud refusal, because a
 * platform that cannot convert to its own accounting currency genuinely cannot price
 * a booking, and pretending otherwise corrupts the books silently.
 *
 * Rates are append-only by convention: changing one inserts a new row with a later
 * `effectiveFrom`, so a booking's snapshotted rate is always reproducible and history
 * is never rewritten.
 */
@Injectable()
export class FxRateService {
  private readonly logger = new Logger(FxRateService.name);
  private readonly cache = new Map<string, CachedRate>();
  private readonly lastStaleWarning = new Map<string, number>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * The rate to use for a booking in `currencyCode`.
   *
   * Throws rather than defaulting. 503 rather than 500 because the system is not
   * broken, it is unconfigured — and rather than 400 because the customer did
   * nothing wrong and has no way to fix it.
   */
  async rateToSyp(currencyCode: string): Promise<string> {
    if (currencyCode === ACCOUNTING_CURRENCY) return '1';

    const cached = this.cache.get(currencyCode);
    if (cached && cached.expiresAt > Date.now()) {
      this.warnIfStale(currencyCode, cached.effectiveFrom);
      return cached.rate;
    }

    /*
      `ORDER BY effective_from DESC, id DESC` — the id breaks a tie, and a tie is not hypothetical.

      An admin correcting a rate seconds after setting it, or a bulk import stamping one moment,
      produces two rows sharing `effective_from`. Ordering by that column alone leaves the winner to
      the planner, so the rate a booking is priced at could differ between two identical requests.
      `uuidv7()` is time-ordered, so `id DESC` means "the one written last" — which is the one an
      admin just corrected TO. `list()` carries the same tiebreak, so the registry an operator reads
      cannot disagree with what pricing actually used.
    */
    const rows = await this.db.execute<{ rate: string; effective_from: string }>(sql`
      SELECT f.rate::text AS rate, f.effective_from::text AS effective_from
      FROM fx_rates f
      JOIN currencies base ON base.id = f.base_currency_id
      JOIN currencies quote ON quote.id = f.quote_currency_id
      WHERE base.code = ${currencyCode}
        AND quote.code = ${ACCOUNTING_CURRENCY}
        AND f.effective_from <= now()
      ORDER BY f.effective_from DESC, f.id DESC
      LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) {
      /**
       * Actionable in the log, generic to the client (rule 1). Whoever is on call
       * needs the exact remedy; the customer needs only to know it is not their
       * fault and not their problem to solve.
       */
      this.logger.error(
        `No ${currencyCode}→${ACCOUNTING_CURRENCY} FX rate is configured, so this ` +
          `booking cannot be priced. Set one via POST /admin/fx-rates ` +
          `({"currency":"${currencyCode}","rate":"..."}). Refusing rather than ` +
          `defaulting to 1, which would understate every SYP figure.`,
      );

      throw unavailable(ERROR.PRICING_UNAVAILABLE);
    }

    const effectiveFrom = new Date(row.effective_from);

    this.cache.set(currencyCode, {
      rate: row.rate,
      effectiveFrom,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    this.warnIfStale(currencyCode, effectiveFrom);

    return row.rate;
  }

  /**
   * Every currency's current rate, for the admin screen.
   *
   * Reports staleness rather than acting on it: refusing to price on an OLD rate
   * would take bookings down on a schedule nobody agreed to, so that remains a
   * deliberate operational decision rather than something this service imposes.
   */
  async list(): Promise<FxRateRecord[]> {
    const rows = await this.db.execute<{
      currency: string;
      rate: string;
      effective_from: string;
      source: string;
      age_hours: string;
    }>(sql`
      SELECT DISTINCT ON (base.code)
             base.code AS currency,
             f.rate::text AS rate,
             f.effective_from::text AS effective_from,
             f.source,
             (EXTRACT(EPOCH FROM (now() - f.effective_from)) / 3600)::text AS age_hours
      FROM fx_rates f
      JOIN currencies base ON base.id = f.base_currency_id
      JOIN currencies quote ON quote.id = f.quote_currency_id
      WHERE quote.code = ${ACCOUNTING_CURRENCY}
        AND f.effective_from <= now()
      ORDER BY base.code, f.effective_from DESC, f.id DESC
    `);

    return rows.rows.map((row) => {
      const ageHours = Number(row.age_hours);

      return {
        currency: row.currency,
        rate: row.rate,
        // Normalised: PostgreSQL renders "2026-07-30 19:48:31.476+00", which is not
        // ISO 8601 and trips strict client-side date parsers.
        effectiveFrom: new Date(row.effective_from).toISOString(),
        source: row.source,
        ageHours: Math.round(ageHours),
        stale: ageHours > STALE_AFTER_HOURS,
      };
    });
  }

  /**
   * Records a new rate.
   *
   * An INSERT, never an update: the previous rate stays readable so a report over a
   * past period reproduces the figure that was in force then, and bookings that
   * snapshotted it remain explicable.
   */
  async set(input: {
    currency: string;
    rate: string;
    effectiveFrom?: string | undefined;
    source: string;
    actorRole?: Role | undefined;
    actorUserId?: string | undefined;
  }): Promise<FxRateRecord> {
    /**
     * When no date is given, the effective time comes from the DATABASE clock, not this process's.
     *
     * `rateToSyp` filters `effective_from <= now()`, which is the database's clock. Stamping the row
     * with `new Date()` therefore compares two clocks, and an app server even slightly ahead of the
     * database future-dates its own write: the rate is in the table, the read refuses it, and pricing
     * answers «التسعير غير متاح مؤقتاً» — the exact outage this service exists to prevent, arriving
     * intermittently and only under skew. One clock decides both halves.
     *
     * An EXPLICIT `effectiveFrom` is still honoured verbatim: scheduling a rate for a future moment,
     * or backdating one, is a deliberate act with a date the caller chose.
     */
    const effectiveAt = input.effectiveFrom
      ? sql`${input.effectiveFrom}::timestamptz`
      : sql`now()`;

    /**
     * The previous rate, captured BEFORE the insert so the audit row can show what
     * changed. "USD went from 11000 to 13000" is the reviewable fact; "a rate was
     * set" is not.
     */
    const previous = (await this.list()).find((r) => r.currency === input.currency);

    let stored = input.effectiveFrom ?? '';

    await this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: string; effective_from: string }>(sql`
        INSERT INTO fx_rates
          (base_currency_id, quote_currency_id, rate, effective_from, source, created_by_user_id)
        SELECT base.id, quote.id, ${input.rate}::numeric, ${effectiveAt},
               ${input.source}, ${input.actorUserId ?? null}
        FROM currencies base, currencies quote
        WHERE base.code = ${input.currency} AND quote.code = ${ACCOUNTING_CURRENCY}
        RETURNING id, effective_from::text AS effective_from
      `);

      if (!rows.rows[0]) {
        /**
         * The SELECT matched nothing, so the currency code is not one SAFRA knows.
         * A 400 is right: unlike a missing rate, this IS the caller's mistake.
         */
        throw badRequest(ERROR.GEO_CURRENCY_UNKNOWN);
      }

      /**
       * Audited in the same transaction, and written here rather than by the route
       * interceptor. The interceptor resolves its subject from a ROUTE PARAM, but the
       * currency and rate arrive in the body — so it recorded only `{"ok":true}`,
       * which tells a reviewer nothing about a change to a financial parameter (§15).
       */
      stored = rows.rows[0].effective_from;

      await this.audit.record(
        {
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
          action: 'fx_rate.set',
          subjectType: 'fx_rate',
          subjectId: rows.rows[0].id,
          before: previous
            ? { currency: previous.currency, rate: previous.rate }
            : { currency: input.currency, rate: null },
          after: {
            currency: input.currency,
            quoteCurrency: ACCOUNTING_CURRENCY,
            rate: input.rate,
            /* What was STORED, not what was intended — they differ whenever the default is used. */
            effectiveFrom: rows.rows[0].effective_from,
            source: input.source,
          },
        },
        tx as unknown as Database,
      );
    });

    /**
     * Invalidated immediately, not left to expire. An admin fixing an outage should
     * see pricing recover on the next request, not up to a minute later.
     */
    this.cache.delete(input.currency);
    this.lastStaleWarning.delete(input.currency);

    this.logger.log(
      `FX rate set: ${input.currency}→${ACCOUNTING_CURRENCY} = ${input.rate} ` +
        `effective ${stored} (${input.source}).`,
    );

    const current = await this.list();
    const record = current.find((r) => r.currency === input.currency);

    // A future-dated rate is not yet current, so `list()` will not return it.
    return (
      record ?? {
        currency: input.currency,
        rate: input.rate,
        effectiveFrom: stored,
        source: input.source,
        ageHours: 0,
        stale: false,
      }
    );
  }

  /** Drops cached rates. Used by tests and after a bulk import. */
  invalidate(): void {
    this.cache.clear();
    this.lastStaleWarning.clear();
  }

  private warnIfStale(currencyCode: string, effectiveFrom: Date): void {
    const ageHours = (Date.now() - effectiveFrom.getTime()) / 3_600_000;
    if (ageHours <= STALE_AFTER_HOURS) return;

    const lastWarned = this.lastStaleWarning.get(currencyCode) ?? 0;
    if (Date.now() - lastWarned < STALE_WARN_INTERVAL_MS) return;

    this.lastStaleWarning.set(currencyCode, Date.now());

    this.logger.warn(
      `${currencyCode}→${ACCOUNTING_CURRENCY} FX rate is ${Math.round(ageHours)}h old. ` +
        `Bookings are still being priced with it; SYP moves fast enough that this ` +
        `should be refreshed.`,
    );
  }
}
