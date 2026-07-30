import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import {
  PERMISSIONS as P,
  type BookingCancelInput,
  type BookingCreateInput,
  type BookingQuoteInput,
  type CursorQuery,
  type PartnerBookingDecisionInput,
  bookingCancelSchema,
  bookingCreateSchema,
  bookingQuoteSchema,
  cursorQuerySchema,
  partnerBookingDecisionSchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, Public, RequirePermissions } from '../rbac/decorators.js';
import { requirePartnerId } from '../rbac/ownership.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { BookingActionsService } from './booking-actions.service.js';
import { BookingCreationService } from './booking-creation.service.js';
import { BookingsService } from './bookings.service.js';

/**
 * Read-only booking access.
 *
 * Deliberately NOT decorated with @RequirePermissions. Both customers
 * (booking.read_own) and staff (booking.read_all) reach these routes, and
 * PermissionsGuard requires ALL listed permissions — so a flat gate would either
 * exclude one group or have to be loosened to "any", which is the weaker
 * guarantee.
 *
 * Instead the service resolves an AccessScope, which decides BOTH whether the
 * caller may read at all and which rows they may see. One mechanism, one place,
 * and it cannot be satisfied without also being scoped.
 *
 * JwtAuthGuard still applies globally — there is no @Public() here, so anonymous
 * requests never arrive.
 */
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly creation: BookingCreationService,
    private readonly actions: BookingActionsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Creates a booking (§6.3 steps 1–4).
   *
   * @Public() because §4 allows a Guest Customer to book with no account. A signed-in
   * customer is still recognised — JwtAuthGuard decodes a token when one is present —
   * so their booking attaches to their existing profile.
   */
  @Public()
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AuditExempt('Audited transactionally inside BookingCreationService.')
  async create(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(bookingCreateSchema)) body: BookingCreateInput,
    @Req() request: Request,
  ) {
    const context = { ipAddress: request.ip, userAgent: request.get('user-agent') };

    // EC-003: a replayed request returns the FIRST response instead of booking twice.
    return this.idempotency.run(
      { key: body.idempotencyKey, scope: 'booking.create', request: body },
      () => this.creation.createDraft(body, user, context),
    );
  }

  /**
   * A price quote without creating anything (§6.3 step 3).
   *
   * @Public() because a guest reaches checkout before authenticating. Read-only and
   * side-effect free: it reserves nothing, so quoting cannot be used to hold
   * inventory.
   */
  @Public()
  @Get('quote')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async quote(
    @Query(new ZodValidationPipe(bookingQuoteSchema)) query: BookingQuoteInput,
  ) {
    return this.creation.quote(query);
  }

  /** The partner answering within the two-hour window (§6.4). */
  @Post(':reference/partner-decision')
  @RequirePermissions(P.BOOKING_RESPOND_AS_PARTNER)
  @AuditExempt('Audited transactionally inside BookingActionsService.')
  async partnerDecision(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(partnerBookingDecisionSchema))
    body: PartnerBookingDecisionInput,
  ) {
    const partnerId = requirePartnerId(user, P.BOOKING_RESPOND_AS_PARTNER);
    return this.actions.partnerDecision(
      reference,
      partnerId,
      body.decision,
      body.reason,
      user,
    );
  }

  /**
   * Marks a booking paid (§6.3 step 5) and posts the ledger entries.
   *
   * Staff-gated stand-in for the payment webhook, which does not exist until a
   * gateway is chosen (ADR 0002). It exists so the lifecycle and the books are
   * exercisable end to end rather than untested until the entity decision lands.
   */
  @Post(':reference/capture-payment')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.BOOKING_UPDATE_STATUS)
  @AuditExempt('Audited transactionally inside BookingActionsService.markPaid.')
  async capturePayment(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.actions.simulateCapture(reference, user);
  }

  /** Staff cancellation (§9.4). Customers cancel through their own bookings view. */
  @Post(':reference/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.BOOKING_CANCEL)
  @AuditExempt('Audited transactionally inside BookingActionsService.')
  async cancel(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(bookingCancelSchema)) body: BookingCancelInput,
  ) {
    return this.actions.cancel(reference, body.reason, 'staff', user);
  }

  @Get()
  async list(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery,
  ) {
    return this.bookings.list(user, query);
  }

  /** Lookup by human reference (BKG-2026-000001), as used in support and vouchers. */
  @Get(':reference')
  async findOne(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.bookings.findByReference(user, reference);
  }
}
