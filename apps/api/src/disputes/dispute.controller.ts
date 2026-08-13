import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  disputeOpenSchema,
  disputeQuerySchema,
  type DisputeOpenInput,
  type DisputeQuery,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { DisputeRequestService } from './dispute-request.service.js';

/**
 * النزاعات, from the asking side.
 *
 * Customers only — the service refuses anyone without a customer profile, for the reason recorded
 * there. Staff have `admin/dispute.service.ts`, which is the queue, the assignment and the closing.
 */
@Controller('disputes')
export class DisputeController {
  constructor(private readonly disputes: DisputeRequestService) {}

  @Get()
  @AuditExempt('Reading your own disputes; changes nothing.')
  async list(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(disputeQuerySchema)) query: DisputeQuery,
  ) {
    return this.disputes.list(user, query);
  }

  /**
   * The bookings this customer could raise a dispute about.
   *
   * A separate read rather than a field on the booking list, because the form needs exactly this
   * question answered — and answering it here means the RULE for what is disputable lives beside the
   * rule that enforces it, instead of being reimplemented in a picker.
   */
  @Get('disputable-bookings')
  @AuditExempt('Reading your own bookings; changes nothing.')
  async disputable(@CurrentUser() user: AccessTokenClaims | undefined) {
    return { items: await this.disputes.disputableBookings(user) };
  }

  @Get(':reference')
  @AuditExempt('Reading one of your own disputes; changes nothing.')
  async detail(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.disputes.detail(user, reference);
  }

  /**
   * Raising one.
   *
   * Throttled hard — harder than opening a support ticket, which is six a minute. A dispute FREEZES
   * the partner's payout for that booking, so a loop here does not merely fill a queue: it stops
   * somebody being paid. Three a minute is generous for a person with a genuine complaint about a
   * stay and useless for anything else.
   */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post()
  @AuditExempt('The dispute row IS the record, and it names who opened it.')
  async open(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(disputeOpenSchema)) body: DisputeOpenInput,
  ) {
    return this.disputes.open(user, body);
  }
}
