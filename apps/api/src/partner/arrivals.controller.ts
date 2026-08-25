import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { cursorQuerySchema, PERMISSIONS as P, type CursorQuery } from '@safra/contracts';

import { ArrivalsService } from './arrivals.service.js';
import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { ViolationsService } from './violations.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { requirePartnerId } from '../rbac/ownership.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * وصول الضيوف — the front desk (Bashar, 2026-08-23).
 *
 * The partner id comes from the verified token on every route; nothing here reads one from the
 * request. "Check in another business's guest" is not a request this controller can express, which
 * is stronger than refusing it.
 */
@Controller('partner/arrivals')
export class ArrivalsController {
  constructor(private readonly arrivals: ArrivalsService) {}

  @Get()
  @RequirePermissions(P.BOOKING_CHECK_IN)
  @AuditExempt('Reading today’s arrivals; changes nothing.')
  async list(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery,
  ) {
    const partnerId = requirePartnerId(user, P.BOOKING_CHECK_IN);

    return this.arrivals.list(partnerId, query);
  }

  /**
   * One booking by reference — §6.5's paper-voucher case (SRS §6.5).
   *
   * ## Throttled harder than the list, because it is the enumerable one
   *
   * A reference is a year plus a sequence, so it is GUESSABLE, and this route answers "yes, that
   * is one of yours" for anything a caller sends. The partner scope bounds the damage to the
   * caller's own bookings — but a receptionist holding `booking.check_in` can see today's arrivals
   * and nothing else, and unthrottled this would let them walk the whole year's guest list. Twenty
   * a minute is more than any desk types and far less than a scrape needs.
   *
   * Declared AFTER the collection route and with no conflicting sibling: `:reference` is the only
   * `GET` path segment this controller claims.
   */
  @Get(':reference')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(P.BOOKING_CHECK_IN)
  @AuditExempt('Reading one of your own bookings; changes nothing.')
  async one(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    const partnerId = requirePartnerId(user, P.BOOKING_CHECK_IN);

    return this.arrivals.find(partnerId, reference);
  }

  /**
   * Throttled at sixty a minute — generous for a desk, useless as a way to churn booking rows.
   *
   * Higher than the employee-management writes because this is the ordinary work of the screen: a
   * coach party arriving means twenty presses in five minutes, and a limit that punishes a busy
   * morning is a limit people work around.
   */
  @Post(':reference/check-in')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @AuditExempt('ArrivalsService records booking.checked_in itself.')
  @RequirePermissions(P.BOOKING_CHECK_IN)
  async checkIn(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    const partnerId = requirePartnerId(user, P.BOOKING_CHECK_IN);

    return this.arrivals.checkIn(user, partnerId, reference);
  }

  /** The same capability undoes it: whoever may record an arrival may correct their own mistake. */
  @Post(':reference/undo-check-in')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @AuditExempt('ArrivalsService records booking.check_in_undone itself.')
  @RequirePermissions(P.BOOKING_CHECK_IN)
  async undoCheckIn(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    const partnerId = requirePartnerId(user, P.BOOKING_CHECK_IN);

    return this.arrivals.undoCheckIn(user, partnerId, reference);
  }
}

/**
 * المخالفات — the penalties on this business.
 *
 * Its own controller rather than a route on the arrivals one: they share nothing but the partner
 * scope, and `violation.read` is a different capability from `booking.check_in`. A reader may hold
 * either without the other.
 */
@Controller('partner/violations')
export class ViolationsController {
  constructor(private readonly violations: ViolationsService) {}

  @Get()
  @RequirePermissions(P.VIOLATION_READ)
  @AuditExempt('Reading your own violations; changes nothing.')
  async list(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery,
  ) {
    const partnerId = requirePartnerId(user, P.VIOLATION_READ);

    return this.violations.list(user, partnerId, query);
  }

  /**
   * ONE violation — the detail screen a partner opens from the list (Bashar, 2026-08-24).
   *
   * `ParseUUIDPipe` so a malformed id is a 400 at the boundary rather than a database error, and
   * the service scopes the row to the token's partner in its WHERE clause: another business's
   * violation answers exactly as one that does not exist.
   */
  @Get(':id')
  @RequirePermissions(P.VIOLATION_READ)
  @AuditExempt('Reading your own violation; changes nothing.')
  async one(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const partnerId = requirePartnerId(user, P.VIOLATION_READ);

    return this.violations.one(user, partnerId, id);
  }
}
