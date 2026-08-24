import { Controller, Get, Param, Post, Query } from '@nestjs/common';
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
}
