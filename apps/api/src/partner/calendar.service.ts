import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import {
  PERMISSIONS as P,
  type CalendarDay,
  type CalendarQuery,
  type CalendarRangeUpdate,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { requirePartnerId } from '../rbac/ownership.js';

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
       AND b.status IN ('pending_payment', 'pending_confirmation', 'confirmed', 'checked_in')
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

    if (rows.length === 0) throw new NotFoundException('Unit not found.');
  }
}
