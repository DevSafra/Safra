import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  supportOpenSchema,
  supportQuerySchema,
  supportReplySchema,
  type SupportOpenInput,
  type SupportQuery,
  type SupportReplyInput,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { SupportService } from './support.service.js';

/**
 * الدعم, from the asking side (Bashar, 2026-08-12).
 *
 * One controller for customers AND partners. The service decides which scope applies from the verified
 * token — a customer carries `customerProfileId`, a partner `partnerId` — so neither can name the other's
 * threads and there is no route parameter that could be tampered with. Two controllers would mean two
 * copies of that decision.
 *
 * Staff do not come through here. `admin/messaging.service.ts` is their side of the same threads, with
 * the internal notes this module deliberately never returns.
 */
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @AuditExempt('Reading your own support requests; changes nothing.')
  async list(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(supportQuerySchema)) query: SupportQuery,
  ) {
    return this.support.list(user, query);
  }

  @Get(':reference')
  @AuditExempt('Reading one of your own threads; changes nothing.')
  async thread(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.support.thread(user, reference);
  }

  /**
   * Opens a ticket.
   *
   * Throttled tightly: this is an unauthenticated-shaped write in the sense that any signed-in person may
   * do it, it puts a row in front of staff, and a loop would flood the console's inbox — the queue real
   * people are waiting in. Six a minute is generous for somebody with a problem and useless for spam.
   */
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post()
  @AuditExempt('The thread IS the record; a duplicate audit row would add nothing to it.')
  async open(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(supportOpenSchema)) body: SupportOpenInput,
  ) {
    return this.support.open(user, body.body);
  }

  /** Replying is throttled less tightly — a conversation is meant to go back and forth. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':reference/reply')
  @AuditExempt('The thread IS the record.')
  async reply(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(supportReplySchema)) body: SupportReplyInput,
  ) {
    return this.support.reply(user, reference, body.body);
  }
}
