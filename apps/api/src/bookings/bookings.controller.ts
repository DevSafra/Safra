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
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import {
  PERMISSIONS as P,
  type BookingCancelInput,
  type BookingRecoveryInput,
  type BookingVerificationInput,
  type BookingStaffConfirmInput,
  type BookingCreateInput,
  type BookingQuoteInput,
  type CouponPreviewInput,
  type CursorQuery,
  type PartnerBookingDecisionInput,
  bookingCancelSchema,
  bookingRecoverySchema,
  bookingVerificationSchema,
  bookingStaffConfirmSchema,
  bookingCreateSchema,
  bookingQuoteSchema,
  couponPreviewSchema,
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
import { BookingRecoveryService } from './booking-recovery.service.js';
import { VoucherService } from './voucher.service.js';
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
    private readonly recovery: BookingRecoveryService,
    private readonly vouchers: VoucherService,
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

  /**
   * Prices a coupon code against a stay, before the customer commits (§9.3's الكوبونات).
   *
   * ## @Public(), like the quote it extends
   *
   * A guest reaches checkout before authenticating, and a coupon they cannot try until after they
   * sign up is a coupon most of them abandon. Nothing is reserved and nothing is written — the
   * redemption happens when the booking is created, under the coupon's row lock.
   *
   * ## Throttled hard, because this endpoint can be guessed at
   *
   * A coupon code is short and shareable by design, so a preview is a place somebody could hunt for
   * live campaign codes. Ten a minute, and a code that does not exist answers exactly what one
   * outside its window answers — `coupon.invalid` — so the response cannot be used to sort real
   * codes from imaginary ones. See `CouponService.preview`.
   *
   * ## The customer never sends an amount
   *
   * Only the code and the stay. What a coupon is worth is decided on the server against prices the
   * server computed; a client-supplied discount would be a price the customer chose.
   */
  @Public()
  @Post('coupon-preview')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async couponPreview(
    @Body(new ZodValidationPipe(couponPreviewSchema)) body: CouponPreviewInput,
  ) {
    return this.creation.previewCoupon(body);
  }

  /**
   * EC-010 tier 1 — «نسيت رقم الحجز». Public, and it answers the same thing to everybody.
   *
   * ## 202, always
   *
   * Not 200-with-a-count and not 404. The status, the body and the shape are identical whether the
   * address holds forty bookings or none, because «does this person have a booking» is the question
   * this endpoint exists to REFUSE — an email address is on every invoice and in every forwarded
   * confirmation, so answering it would make this an oracle. What was found travels to the mailbox.
   *
   * ## Throttled harder than sign-in
   *
   * Five a minute. Not against guessing — there is nothing to guess — but against using SAFRA as a
   * mailer: each call sends a message to an address the caller chose.
   */
  @Public()
  @Post('recover')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @AuditExempt('Auditing this would record which addresses were asked about, by anybody.')
  async recover(
    @Body(new ZodValidationPipe(bookingRecoverySchema)) body: BookingRecoveryInput,
  ) {
    await this.recovery.recover(body.email);

    /* A fixed body. Anything derived from what was found would leak it. */
    return { sent: true };
  }

  /**
   * EC-010 tier 2, step one — send a code to the contact details ON this booking.
   *
   * `BOOKING_READ_ALL`: the agent already holds the reference, and this discloses nothing further
   * — the reply is a MASKED destination. What it does is put a message in the customer's mailbox,
   * which is why it is throttled and audited by channel.
   */
  @Post(':reference/verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(P.BOOKING_READ_ALL)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AuditExempt(
    'BookingRecoveryService records booking.verification_sent, by channel only.',
  )
  async sendVerification(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.recovery.sendCode(reference, user);
  }

  /** Step two — the caller read it back. One answer for every kind of failure; see the service. */
  @Post(':reference/verification/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.BOOKING_READ_ALL)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AuditExempt('BookingRecoveryService records booking.verification_passed.')
  async confirmVerification(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(bookingVerificationSchema))
    body: BookingVerificationInput,
  ) {
    return this.recovery.verify(reference, body.code, user);
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

  /**
   * SAFRA confirms on the partner's behalf (§6.3 step 7) — the staff half of `partner-decision`.
   *
   * `BOOKING_UPDATE_STATUS`, not `BOOKING_RESPOND_AS_PARTNER`: this is not somebody acting AS the
   * partner, it is SAFRA exercising the position §6.3 gives it in the middle of the confirmation.
   * The partner route needs a partner id from the token and a support agent has none, which is why
   * the call a partner makes to support could not be recorded anywhere until now.
   */
  @Post(':reference/staff-confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.BOOKING_UPDATE_STATUS)
  @AuditExempt('Audited transactionally inside BookingActionsService.')
  async staffConfirm(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(bookingStaffConfirmSchema))
    body: BookingStaffConfirmInput,
  ) {
    return this.actions.staffConfirm(reference, body.reason, user);
  }

  /**
   * Staff record an arrival, for a partner who cannot reach their own portal.
   *
   * `BOOKING_CHECK_IN` — the same capability the partner's front desk holds, because it is the
   * same act. The ordinary path stays `POST /partner/arrivals/:reference/check-in`; this differs
   * only in having no `partner_id` in its predicate, since staff are not acting for one business.
   */
  @Post(':reference/check-in')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.BOOKING_CHECK_IN)
  @AuditExempt('Audited transactionally inside BookingActionsService.')
  async checkIn(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.actions.staffCheckIn(reference, user);
  }

  /** Undoes it. Bounded to `checked_in`, so it cannot reach into a completed or disputed stay. */
  @Post(':reference/undo-check-in')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.BOOKING_CHECK_IN)
  @AuditExempt('Audited transactionally inside BookingActionsService.')
  async undoCheckIn(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.actions.staffUndoCheckIn(reference, user);
  }

  /**
   * Ends a stay by hand — the exception to `stay-completion`, which is the ordinary path.
   *
   * `checked_in → completed` had no writer of any kind before 2026-08-25, and `completed` is what
   * `PayoutService` accrues over and `ReviewService` requires. The hourly sweep does this for
   * every departed stay; this exists for the one whose dates say it is still running and whose
   * guest has demonstrably gone.
   */
  @Post(':reference/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.BOOKING_UPDATE_STATUS)
  @AuditExempt('Audited transactionally inside BookingActionsService.')
  async complete(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.actions.staffComplete(reference, user);
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

  /**
   * The booking voucher, as a PDF (SRS §6.3 step 6, §6.5).
   *
   * ## Scoped like every other booking read, not `@Public()`
   *
   * `BookingsService` resolves an AccessScope — a customer sees their own, staff see all — and
   * this reads through the same door by asking that service first. A public voucher endpoint keyed
   * on the reference alone would be exactly the enumeration hole §13.2 warns about: the reference
   * is a year-scoped sequence, so anybody can guess a live one.
   *
   * A GUEST with no account reaches their voucher the way they reach everything else about their
   * booking — the access token minted at creation, checked by `BookingAccessService`.
   */
  @Get(':reference/voucher')
  async voucher(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Res() response: Response,
  ) {
    /* The scope check, first and by the same service every other read uses. */
    await this.bookings.findByReference(user, reference);

    const { pdf } = await this.vouchers.pdf(reference);

    response.setHeader('Content-Type', 'application/pdf');
    /*
      `inline`, not `attachment`. A voucher is shown at a desk far more often than it is filed, and
      a phone that downloads it puts it behind a file manager at exactly the wrong moment.
    */
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(reference)}.pdf"`,
    );
    /* Never cached: a voucher is a VIEW of a booking and its status can change. */
    response.setHeader('Cache-Control', 'no-store');
    response.send(pdf);
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
