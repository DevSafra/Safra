import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';

import { DATABASE } from '../database/database.module.js';

/** Cached briefly so the booking hot path never pays a query for a constant. */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * Reads operational configuration from the database (principle P-005).
 *
 * Commission rates, the confirmation SLA, the same-day cutoff and the refund floor
 * are all admin-editable, so nothing that consumes them may hardcode a value. Each
 * getter takes a fallback used ONLY when the key is absent — that keeps a
 * half-seeded database from taking the API down, while a real configured value
 * always wins.
 *
 * In-process cache with a short TTL. It is intentionally not Redis-backed yet:
 * a 30-second window across a handful of stateless nodes is acceptable for these
 * values, and bookings snapshot whatever they used anyway (bookings.customerFeeRate),
 * so a brief disagreement between nodes cannot corrupt an existing booking.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }

    const row = await this.db.query.settings.findFirst({
      where: and(
        eq(schema.settings.key, key),
        eq(schema.settings.scope, 'global'),
        isNull(schema.settings.deletedAt),
      ),
      columns: { value: true },
    });

    if (!row) {
      this.logger.warn(
        `Setting "${key}" is missing; using fallback. Run the database seed.`,
      );
      this.cache.set(key, { value: fallback, expiresAt: Date.now() + CACHE_TTL_MS });
      return fallback;
    }

    this.cache.set(key, { value: row.value, expiresAt: Date.now() + CACHE_TTL_MS });
    return row.value as T;
  }

  /**
   * Numeric accessor that refuses to coerce nonsense.
   *
   * A malformed setting returns the fallback and logs loudly rather than letting
   * NaN reach a price calculation — `NaN` in a commission produces a booking total
   * of `NaN`, which is far worse than using a sane default.
   */
  async getNumber(key: string, fallback: number): Promise<number> {
    const raw = await this.get<unknown>(key, fallback);
    const value = typeof raw === 'string' ? Number(raw) : raw;

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.logger.error(
        `Setting "${key}" is not a finite number (${String(raw)}); using fallback.`,
      );
      return fallback;
    }

    return value;
  }

  /**
   * A setting read as a boolean, with the same «unreadable value falls back» contract as
   * `getNumber` above.
   *
   * `'true'` and `'false'` are accepted as strings because a setting arrives as `jsonb` and an
   * operator editing one through the console types text — the console POSTs `"true"`, the seed
   * writes `true`, and both must mean the same thing. Anything else is a misconfigured setting
   * rather than a permission to guess: it logs and uses the fallback, which for every switch on
   * this platform is the SAFE side of the rule.
   */
  async getBoolean(key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.get<unknown>(key, fallback);

    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;

    this.logger.error(
      `Setting "${key}" is not a boolean (${String(raw)}); using fallback ${String(fallback)}.`,
    );

    return fallback;
  }

  /** Invalidate after an admin write, so a change takes effect immediately. */
  invalidate(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }
}
