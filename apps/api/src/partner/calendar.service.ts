import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import {
  ERROR,
  PERMISSIONS as P,
  decodeCursor,
  encodeCursor,
  type CalendarDay,
  type CalendarQuery,
  type CalendarRangeUpdate,
  type PortfolioCalendar,
  type PortfolioCalendarProperty,
  type PortfolioCalendarUnit,
  type PortfolioCalendarQuery,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { requirePartnerId } from '../rbac/ownership.js';
import { badRequest, notFound } from '../common/errors/app-error.js';

/** A uuid, checked before it reaches a `::uuid` cast so a forged cursor is a 400 and not a 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The booking states that OCCUPY a night.
 *
 * One fragment because TWO calendars read it now — a single unit's month and the whole portfolio's
 * — and a night shown as booked on one screen and free on the other is worse than either answer on
 * its own. Written once here, it cannot drift between them.
 *
 * `completed` and `cancelled` are deliberately absent: a finished stay no longer holds the night,
 * and a cancelled one never did.
 */
const OCCUPYING_STATUSES = sql`('pending_payment', 'pending_confirmation', 'confirmed', 'checked_in')`;

@Injectable()
export class CalendarService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * Reads a unit's calendar for a date range.
   *
   * Generated from a date series rather than from stored rows, so every requested
   * day appears even where no row exists. An absent row means "available at the
   * base price" (§8.4 puts the burden on the partner to CLOSE dates), and a
   * calendar UI needs a cell for every day regardless.
   *
   * `booked` is derived from real bookings and overlaid on top, so the partner sees
   * true occupancy without that state ever being writable by hand.
   */
  async read(
    claims: AccessTokenClaims | undefined,
    unitId: string,
    query: CalendarQuery,
  ): Promise<{ unitId: string; days: CalendarDay[] }> {
    const partnerId = requirePartnerId(claims, P.CALENDAR_MANAGE_OWN);
    await this.assertOwnsUnit(partnerId, unitId);

    const rows = await this.db.execute<{
      date: string;
      status: CalendarDay['status'];
      price: string;
      is_price_overridden: boolean;
      min_nights: number;
      note: string | null;
    }>(sql`
      SELECT
        d.day::date::text                             AS date,
        -- A live booking always wins over the partner's declared state.
        CASE WHEN b.id IS NOT NULL THEN 'booked'
             ELSE COALESCE(ad.status, 'available')
        END                                           AS status,
        COALESCE(ad.price, u.base_price)::text        AS price,
        (ad.price IS NOT NULL)                        AS is_price_overridden,
        COALESCE(ad.min_nights, u.min_nights)         AS min_nights,
        ad.note
      FROM units u
      CROSS JOIN generate_series(
        ${query.from}::date, ${query.to}::date, INTERVAL '1 day'
      ) AS d(day)
      LEFT JOIN availability_days ad
        ON ad.unit_id = u.id AND ad.date = d.day::date
      LEFT JOIN bookings b
        ON b.unit_id = u.id
       AND b.status IN ${OCCUPYING_STATUSES}
       AND d.day::date >= b.check_in
       AND d.day::date <  b.check_out
      WHERE u.id = ${unitId}
      ORDER BY d.day
    `);

    return {
      unitId,
      days: rows.rows.map((r) => ({
        date: r.date,
        status: r.status,
        price: r.price,
        isPriceOverridden: r.is_price_overridden,
        minNights: r.min_nights,
        note: r.note,
      })),
    };
  }

  /**
   * Every unit's month, grouped under the property that owns it (Bashar, 2026-08-10).
   *
   * ## Why this is not the per-unit read in a loop
   *
   * The screen shows a whole portfolio, so calling `read` once per unit would be one round trip per
   * room — the `N+1` rule 2 forbids, and it gets worse exactly as a partner grows. This is TWO
   * queries whatever the portfolio: one indexed page of properties, then one expansion of the
   * month for the units those properties own.
   *
   * ## Bounded on both axes
   *
   * A month, so days per unit is at most 31 by construction — see `calendarMonthSchema` for why a
   * free `from`/`to` is not safe here. And a page of PROPERTIES, so units per answer is bounded by
   * the handful of properties in the page rather than by the size of the portfolio. Paginating by
   * property rather than by unit is what lets the screen group rooms under a heading without a page
   * boundary ever splitting a property's rooms in half.
   *
   * ## Inactive units are included
   *
   * Unlike the dashboard's counters, which exclude them because an off-sale unit is not something a
   * customer can book. This screen answers a different question — what do I own, and what is its
   * month — and a page that silently dropped a room would read as having lost it. `isActive` travels
   * so the UI can mark it.
   */
  async readPortfolio(
    claims: AccessTokenClaims | undefined,
    query: PortfolioCalendarQuery,
  ): Promise<PortfolioCalendar> {
    const partnerId = requirePartnerId(claims, P.CALENDAR_MANAGE_OWN);

    /**
     * A malformed cursor is a 400, not a silent restart from page one.
     *
     * The same call `bookings.service.ts` makes, for the same reason: starting over quietly sends a
     * client that mishandles the cursor into an infinite loop, fetching page one for ever while
     * believing it is advancing. The uuid check is part of it here — the id reaches a `::uuid`
     * cast, and a forged cursor should not be able to turn that into a 500.
     */
    let after: { sortKey: string; id: string } | null = null;

    if (query.cursor !== undefined) {
      const decoded = decodeCursor(query.cursor);

      if (!decoded || !UUID.test(decoded.id)) {
        throw badRequest(ERROR.REQUEST_CURSOR_INVALID);
      }

      after = { sortKey: decoded.sortKey, id: decoded.id };
    }

    /*
      The sort key stays a STRING the whole way through, and that is load-bearing.
      `properties.created_at` is a `timestamptz` holding MICROseconds while a JS Date holds
      milliseconds, so round-tripping the key through a Date truncates it — and
      `(created_at, id) > (truncated, id)` is then true of the cursor's own row, which reappears at
      the top of every following page. `encodeCursor` documents the trap; this is a caller that has
      to respect it.
    */
    const keyset = after
      ? sql`AND (p.created_at, p.id) > (${after.sortKey}::timestamptz, ${after.id}::uuid)`
      : sql``;

    // One row beyond the page answers "is there another" without a second COUNT over the portfolio.
    const properties = await this.db.execute<{
      id: string;
      reference: string;
      name_ar: string;
      created_at: string;
    }>(sql`
      SELECT p.id, p.reference, p.name_ar, p.created_at::text AS created_at
      FROM properties p
      WHERE p.partner_id = ${partnerId}
        AND p.deleted_at IS NULL
        ${keyset}
      ORDER BY p.created_at, p.id
      LIMIT ${query.limit + 1}
    `);

    const page = properties.rows.slice(0, query.limit);
    const last = page[page.length - 1];

    const nextCursor =
      properties.rows.length > query.limit && last
        ? encodeCursor(last.created_at, last.id)
        : null;

    // No properties at all, or a cursor past the end. Either way there is nothing to expand.
    if (page.length === 0) {
      return { month: query.month, properties: [], nextCursor: null };
    }

    const first = `${query.month}-01`;

    /*
      Which property's month to EXPAND — the one the reader has open.

      Days are the expensive part of this screen: one property times its units times every day of
      the month. Expanding every listed property is what forced a ceiling of ten and put a partner's
      eleventh property out of reach (Bashar, 2026-08-19). Expanding ONE keeps the cost flat however
      large the portfolio, so the list no longer has to be short.

      An `expand` naming a property this partner does not own simply does not match, and the first
      of their own is expanded instead — the scoping is the page query above, not a check here.
    */
    const expanded =
      page.find((property) => property.reference === query.expand) ?? page[0];

    /*
      Unit METADATA for every listed property, with no days.

      Cheap — one indexed read per property, no date series — and the folder needs it while closed:
      a summary that could not say «5 وحدة» until it was opened would make the reader open every
      folder to find out where anything is.
    */
    const units = await this.db.execute<{
      property_id: string;
      unit_id: string;
      unit_name: string;
      unit_label: string | null;
      is_active: boolean;
      base_price: string;
      currency_code: string;
      unit_min_nights: number;
    }>(sql`
      SELECT u.property_id, u.id AS unit_id, u.name_ar AS unit_name, u.unit_label,
             u.is_active, u.base_price::text AS base_price, c.code AS currency_code,
             u.min_nights AS unit_min_nights
      FROM units u
      JOIN currencies c ON c.id = u.currency_id
      WHERE u.property_id IN ${page.map((property) => property.id)}
        AND u.deleted_at IS NULL
      ORDER BY u.created_at, u.id
    `);

    const days = await this.db.execute<{
      unit_id: string;
      date: string;
      status: CalendarDay['status'];
      price: string;
      is_price_overridden: boolean;
      min_nights: number;
      note: string | null;
    }>(sql`
      SELECT
        u.id                                          AS unit_id,
        d.day::date::text                             AS date,
        -- A live booking always wins over the partner's declared state, as the per-unit read does.
        CASE WHEN b.id IS NOT NULL THEN 'booked'
             ELSE COALESCE(ad.status, 'available')
        END                                           AS status,
        COALESCE(ad.price, u.base_price)::text        AS price,
        (ad.price IS NOT NULL)                        AS is_price_overridden,
        COALESCE(ad.min_nights, u.min_nights)         AS min_nights,
        ad.note                                       AS note
      FROM units u
      /*
        The month derived in SQL rather than in TypeScript: plus one month minus one day is right
        for February and for a leap year without either side knowing which month it was handed.
      */
      CROSS JOIN generate_series(
        ${first}::date,
        ${first}::date + INTERVAL '1 month' - INTERVAL '1 day',
        INTERVAL '1 day'
      ) AS d(day)
      LEFT JOIN availability_days ad
        ON ad.unit_id = u.id AND ad.date = d.day::date
      LEFT JOIN bookings b
        ON b.unit_id = u.id
       AND b.status IN ${OCCUPYING_STATUSES}
       AND d.day::date >= b.check_in
       AND d.day::date <  b.check_out
      WHERE u.property_id = ${expanded?.id ?? null}
        AND u.deleted_at IS NULL
      ORDER BY u.created_at, u.id, d.day
    `);

    /*
      Seeded from the property PAGE, not from the unit rows, so a property with no units yet still
      appears — as itself, with an empty list. Building the map from the rows instead would make an
      empty property vanish, which reads as the page having lost it rather than as a property having
      no rooms.
    */
    const byProperty = new Map<string, PortfolioCalendarProperty>(
      page.map((p) => [p.id, { reference: p.reference, nameAr: p.name_ar, units: [] }]),
    );

    const byUnit = new Map<string, PortfolioCalendarUnit>();

    for (const row of units.rows) {
      const property = byProperty.get(row.property_id);

      if (!property) continue;

      const unit: PortfolioCalendarUnit = {
        unitId: row.unit_id,
        nameAr: row.unit_name,
        unitLabel: row.unit_label,
        basePrice: row.base_price,
        currencyCode: row.currency_code,
        minNights: row.unit_min_nights,
        isActive: row.is_active,
        /* Empty on every property but the expanded one — see `expand` in the query contract. */
        days: [],
      };

      property.units.push(unit);
      byUnit.set(row.unit_id, unit);
    }

    for (const row of days.rows) {
      byUnit.get(row.unit_id)?.days.push({
        date: row.date,
        status: row.status,
        price: row.price,
        isPriceOverridden: row.is_price_overridden,
        minNights: row.min_nights,
        note: row.note,
      });
    }

    return { month: query.month, properties: [...byProperty.values()], nextCursor };
  }

  /**
   * Applies a change across a date range (§8.4).
   *
   * Written as a single set-based upsert over a generated date series. The obvious
   * alternative — loop the days in TypeScript and issue one statement each — turns
   * a one-year closure into 365 round trips, and a partner blocking a season is a
   * routine action.
   *
   * Note on bookings: closing a date that already carries a confirmed booking is
   * ALLOWED and does not cancel it. The calendar records the partner's intent for
   * future availability; live bookings remain authoritative and are honoured. A
   * partner wanting out of a confirmed booking must go through SAFRA (P-001), not
   * through the calendar.
   */
  async updateRange(
    claims: AccessTokenClaims | undefined,
    unitId: string,
    input: CalendarRangeUpdate,
  ): Promise<{ unitId: string; daysAffected: number }> {
    const partnerId = requirePartnerId(claims, P.CALENDAR_MANAGE_OWN);
    await this.assertOwnsUnit(partnerId, unitId);

    const result = await this.db.transaction(async (tx) => {
      const written = await tx.execute<{ count: string }>(sql`
        WITH days AS (
          SELECT d.day::date AS date
          FROM generate_series(${input.from}::date, ${input.to}::date, INTERVAL '1 day') AS d(day)
        ),
        upserted AS (
          INSERT INTO availability_days (unit_id, date, status, price, min_nights, note)
          SELECT
            ${unitId}::uuid,
            days.date,
            -- status is NOT NULL, so a NEW row needs a concrete value. A price-only
            -- or minNights-only update must not fail just because no status was
            -- supplied: an absent row is available by definition, so that is the
            -- correct value to materialise.
            COALESCE(${input.status ?? null}::day_status, 'available'),
            ${input.price ?? null}::numeric,
            ${input.minNights ?? null}::smallint,
            ${input.note ?? null}::text
          FROM days
          ON CONFLICT (unit_id, date) DO UPDATE SET
            -- Each field branches on whether it was SUPPLIED, decided in TS before
            -- the statement is built. COALESCE(EXCLUDED.x, existing) cannot express
            -- this: the INSERT list has to default status to 'available' to satisfy
            -- NOT NULL, so EXCLUDED.status is never null and COALESCE would always
            -- pick it — silently reopening dates a partner had closed whenever they
            -- edited only the price. That is an overbooking bug, not a cosmetic one.
            status     = ${input.status === undefined ? sql`availability_days.status` : sql`EXCLUDED.status`},
            price      = ${input.price === undefined ? sql`availability_days.price` : sql`EXCLUDED.price`},
            min_nights = ${input.minNights === undefined ? sql`availability_days.min_nights` : sql`EXCLUDED.min_nights`},
            note       = COALESCE(EXCLUDED.note, availability_days.note),
            updated_at = now()
          RETURNING 1
        )
        SELECT COUNT(*)::text AS count FROM upserted
      `);

      const daysAffected = Number(written.rows[0]?.count ?? 0);

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'calendar.range_updated',
          subjectType: 'unit',
          subjectId: unitId,
          after: {
            from: input.from,
            to: input.to,
            status: input.status,
            price: input.price,
            minNights: input.minNights,
            daysAffected,
          },
        },
        tx as unknown as Database,
      );

      return daysAffected;
    });

    return { unitId, daysAffected: result };
  }

  private async assertOwnsUnit(partnerId: string, unitId: string): Promise<void> {
    const rows = await this.db
      .select({ id: schema.units.id })
      .from(schema.units)
      .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
      .where(
        and(
          eq(schema.units.id, unitId),
          eq(schema.properties.partnerId, partnerId),
          isNull(schema.units.deletedAt),
          isNull(schema.properties.deletedAt),
        ),
      )
      .limit(1);

    if (rows.length === 0) throw notFound(ERROR.UNIT_NOT_FOUND);
  }
}
