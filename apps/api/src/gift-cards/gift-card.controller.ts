import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  giftCardPurchaseSchema,
  giftCardQuerySchema,
  giftCardRedeemSchema,
  type GiftCardPurchaseInput,
  type GiftCardQuery,
  type GiftCardRedeemInput,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { GiftCardService } from './gift-card.service.js';

/**
 * بطاقات الهدايا (handoff §6).
 *
 * Every handler derives the customer from the VERIFIED token and takes no customer id, so "credit
 * somebody else's wallet" and "list their cards" are questions this controller cannot be asked. There
 * is no permission decorator because there is no permission to hold: any signed-in customer may redeem
 * a code or buy a card, and the absence of a customer profile on the token refuses a partner or staff
 * member.
 *
 * The code arrives in a BODY, never a path or query string. A query string is written to access logs,
 * kept in browser history and sent in a `Referer`, and this particular string is spendable.
 */
@Controller('gift-cards')
export class GiftCardController {
  constructor(private readonly giftCards: GiftCardService) {}

  @Get()
  @AuditExempt('A customer reading the cards they bought; changes nothing.')
  async list(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(giftCardQuerySchema)) query: GiftCardQuery,
  ) {
    return this.giftCards.list(user, query);
  }

  /**
   * Redeems a code into the caller's wallet.
   *
   * **Throttled hard, and this is the route that most needs it.** A gift-card code is a bearer
   * instrument, so an unthrottled endpoint is an oracle for testing guesses. Ten a minute is generous
   * for a person typing a code off a card and useless for enumeration — though the real defence is the
   * 100 bits of entropy in the code itself, because a rate limit only slows an attacker down.
   *
   * Not `@AuditExempt`: the service writes its own audit row, because money moves.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('redeem')
  @AuditExempt('Audited by the service, which records the card reference and the amount.')
  async redeem(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(giftCardRedeemSchema)) body: GiftCardRedeemInput,
  ) {
    return this.giftCards.redeem(user, body.code);
  }

  /**
   * Buys a card out of the caller's wallet balance.
   *
   * Throttled because it moves money and mints a bearer instrument; a loop here would drain a wallet
   * into a pile of cards. The response carries the plaintext code ONCE — see the service.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  @AuditExempt(
    'Audited by the service, which records the reference and the amount, never the code.',
  )
  async purchase(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(giftCardPurchaseSchema)) body: GiftCardPurchaseInput,
  ) {
    return this.giftCards.purchase(user, body);
  }
}
