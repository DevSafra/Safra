import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import {
  ERROR,
  type CursorPage,
  type CursorQuery,
  decodeCursor,
  encodeCursor,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import {
  type AccessScope,
  assertReadable,
  resolveBookingScope,
} from '../rbac/ownership.js';
import { badRequest, notFound } from '../common/errors/app-error.js';

/** The projection any authenticated caller may see. */
const BOOKING_COLUMNS = {
  id: true,
  reference: true,
  status: true,
  checkIn: true,
  checkOut: true,
  nights: true,
  guestsAdults: true,
  guestsChildren: true,
  guestsInfants: true,
  totalAmount: true,
  currencyId: true,
  confirmationDeadlineAt: true,
  createdAt: true,
} as const;

@Injectable()
export class BookingsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Lists bookings visible to the caller.
   *
   * The scope becomes part of the WHERE clause rather than a filter applied to
   * results, so an unauthorised row is never read out of the database in the first
   * place — there is nothing to accidentally serialise.
   */
  async list(
    claims: AccessTokenClaims | undefined,
    query: CursorQuery,
  ): Promise<CursorPage<Record<string, unknown>>> {
    const scope = assertReadable(resolveBookingScope(claims));

    const conditions: SQL[] = [isNull(schema.bookings.deletedAt)];

    const ownership = this.ownershipCondition(scope);
    if (ownership) {
      conditions.push(ownership);
    }

    /**
     * A malformed cursor is a 400, not a silent restart from page 1.
     *
     * Silently ignoring it looks harmless but sends any client that mishandles the
     * cursor into an infinite pagination loop: it fetches page 1 forever while
     * believing it is advancing. Failing loudly surfaces the client bug on the
     * first request instead of as unbounded load on the database.
     */
    let after: { createdAt: Date; id: string } | null = null;
    if (query.cursor !== undefined) {
      after = decodeCursor(query.cursor);

      if (!after) {
        throw badRequest(ERROR.REQUEST_CURSOR_INVALID);
      }
    }

    if (after) {
      /**
       * Keyset comparison on (createdAt, id). The id tiebreaker matters: without
       * it, bookings sharing a timestamp would be skipped or repeated across page
       * boundaries.
       */
      const keyset = or(
        lt(schema.bookings.createdAt, after.createdAt),
        and(
          eq(schema.bookings.createdAt, after.createdAt),
          lt(schema.bookings.id, after.id),
        ),
      );
      if (keyset) {
        conditions.push(keyset);
      }
    }

    // Fetch one extra row to learn whether a further page exists, without a
    // second COUNT query over the whole table.
    const rows = await this.db.query.bookings.findMany({
      columns: BOOKING_COLUMNS,
      where: and(...conditions),
      orderBy: [desc(schema.bookings.createdAt), desc(schema.bookings.id)],
      limit: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);

    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  /**
   * Fetches one booking by reference.
   *
   * A booking the caller may not see returns 404, NOT 403. A 403 would confirm the
   * reference exists, and references are sequential (BKG-2026-000001…), so a 403
   * would let anyone enumerate the platform's entire booking volume and guess at
   * neighbours. "Not found" is the honest answer from the caller's perspective:
   * within their scope, it does not exist.
   */
  async findByReference(
    claims: AccessTokenClaims | undefined,
    reference: string,
  ): Promise<Record<string, unknown>> {
    const scope = assertReadable(resolveBookingScope(claims));

    const conditions: SQL[] = [
      eq(schema.bookings.reference, reference),
      isNull(schema.bookings.deletedAt),
    ];

    const ownership = this.ownershipCondition(scope);
    if (ownership) {
      conditions.push(ownership);
    }

    /*
      The property and unit are joined HERE and not in `list`.

      A detail screen has to say WHERE the stay is — a reference, a date range and a total describe
      a transaction rather than a trip, and the customer's own screen was showing exactly that. A
      list row has no space for it and would pay for the join on every page.

      Nothing is widened by this: every caller that reaches a booking at all is already scoped to it
      — a customer booked it, a partner owns the property, staff see everything — so the names add
      no reach. Only the names, though: the `properties` row carries an address and a partner id,
      and a detail screen needs neither.
    */
    const booking = await this.db.query.bookings.findFirst({
      columns: BOOKING_COLUMNS,
      where: and(...conditions),
      with: {
        property: { columns: { nameAr: true, nameEn: true, nameDe: true } },
        unit: { columns: { nameAr: true, nameEn: true, nameDe: true } },
        /*
          The city SLUG, so the booking's own page can carry the city's partner ads.

          §9.3 places advertising «حسب مدينة حجز العميل» — a customer who booked in Damascus is
          shown Damascus restaurants — and a screen cannot ask for that without knowing which city
          the booking is in. The slug is a public identifier: `/city/damascus` is a page anybody can
          open, so it adds no reach to a caller already scoped to this booking.
        */
        city: { columns: { slug: true } },
      },
    });

    if (!booking) {
      throw notFound(ERROR.BOOKING_NOT_FOUND);
    }

    return booking;
  }

  /**
   * Translates a scope into SQL. Returns undefined for `all` (no narrowing).
   *
   * A customer is matched on customerProfileId and a partner on partnerId, so a
   * partner sees bookings AT their properties without seeing other partners', and
   * a customer sees only their own.
   */
  private ownershipCondition(
    scope: Exclude<AccessScope, { kind: 'none' }>,
  ): SQL | undefined {
    if (scope.kind === 'all') {
      return undefined;
    }

    if (scope.customerProfileId) {
      return eq(schema.bookings.customerProfileId, scope.customerProfileId);
    }

    if (scope.partnerId) {
      return eq(schema.bookings.partnerId, scope.partnerId);
    }

    /**
     * Unreachable: resolveScope() already returns `none` when an `own` scope has
     * no owning id, and assertReadable() rejects that. Kept as a fail-closed
     * backstop so a future change to resolveScope cannot silently turn an
     * unscoped query loose on the whole table.
     */
    return sql`false`;
  }
}
