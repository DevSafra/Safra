import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import {
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
        throw new BadRequestException('Malformed pagination cursor.');
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

    const booking = await this.db.query.bookings.findFirst({
      columns: BOOKING_COLUMNS,
      where: and(...conditions),
    });

    if (!booking) {
      throw new NotFoundException('Booking not found.');
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
