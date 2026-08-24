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
 *
 * ## No `@RequirePermissions` on any route, and that is a DECISION
 *
 * Recorded here because its absence is otherwise indistinguishable from an oversight, and a
 * capability sweep will keep finding it. `message.read` and `message.send` exist, are held by
 * customers and partners, and ARE grantable to an employee — so gating these routes on them would
 * be the obvious move. It is the wrong one, twice over:
 *
 * 1. **It would lock out the person the screen is for.** A partner employee whose role ticks
 *    nothing can open no section of the portal. الدعم is deliberately absent from
 *    `PARTNER_SECTION_PERMISSIONS` so that person can still ask why. Gating the API behind a
 *    capability their employer did not grant makes the portal able to lock somebody out of the way
 *    to report being locked out.
 * 2. **The capability would grant nothing anyway.** Every route here is scoped to the caller's own
 *    data by `SupportService.askerOf` — a customer to their own profile, an employee to the threads
 *    they opened, a partner to the business's. There is no wider read behind a permission check,
 *    so the check could only ever subtract.
 *
 * Authentication is still required: `JwtAuthGuard` is global and nothing here is `@Public()`. What
 * is absent is a CAPABILITY requirement, not a session one.
 *
 * Where `message.read` and `message.send` genuinely gate something is `admin/comms.controller.ts` —
 * staff reading and replying to other people's conversations, which is a wider read and is guarded.
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

  /**
   * "I no longer need help."
   *
   * No body: the reference in the path is the whole request, and the service takes the owner from the
   * token rather than from anything sent. There is nothing here a caller could tamper with.
   *
   * Throttled like a reply rather than like opening a ticket. It is idempotent and it REMOVES work
   * from the console queue, so the thing worth limiting is a loop, not a person pressing twice.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':reference/close')
  @AuditExempt('The thread IS the record; closed_at is on it.')
  async close(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.support.close(user, reference);
  }
}
