import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Headers,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import {
  PERMISSIONS as P,
  type CreateRefundRequest,
  type StartPaymentRequest,
  createRefundSchema,
  refundIdSchema,
  startPaymentSchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, Public, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { PaymentIntentService } from './payment-intent.service.js';
import { PaymentWebhookService } from './payment-webhook.service.js';
import { RefundService } from './refund.service.js';
import { PaymentProviderRegistry } from './providers/provider.registry.js';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly intents: PaymentIntentService,
    private readonly webhooks: PaymentWebhookService,
    private readonly refunds: RefundService,
    private readonly registry: PaymentProviderRegistry,
  ) {}

  /**
   * Which methods checkout may show (§7.1).
   *
   * @Public() because the customer needs it before authenticating and before any
   * booking exists. It reveals nothing sensitive — the set of rails SAFRA accepts is
   * printed in the footer of every comparable site.
   *
   * Country is the PROPERTY's, since that is what routing keys on; an unrecognised
   * or absent value falls through to the wildcard route rather than erroring, so a
   * checkout page never breaks over a missing query parameter.
   */
  @Public()
  @Get('methods')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async methods(@Query('country') country?: string) {
    const code = /^[A-Za-z]{2}$/.test(country ?? '') ? (country as string) : '*';

    /*
      The list alone again (Bashar, 2026-09-08).

      It answered `offline` alongside `methods` so checkout could tell «nothing can take money»
      from «one rail serves everyone, so there is nothing to choose» — the ambiguity behind finding
      214. Removing the bank-transfer journey removes the ambiguity: from the customer's side
      nothing can take money, and one sentence is true again.

      Kept where it is still read: `StartPaymentResult.offline` decides whether the checkout form
      follows a provider's redirect, and `BookingDetailService` decides from the same flag whether
      finance is offered «تأكيد استلام الحوالة».
    */
    return { methods: await this.registry.availableMethodsForCountry(code) };
  }

  /**
   * Begins a payment attempt (§6.3 step 4).
   *
   * @Public() because §4 permits booking without an account — there is no session to
   * check at this point. Authorization is the booking access token in the body,
   * which the guest received once when the booking was created. That is a stronger
   * check than a session would be here: it proves possession of a specific booking
   * rather than merely being some logged-in user.
   *
   * Throttled hard. This route resolves a provider and can trigger an outbound
   * gateway call, so it is both expensive and the natural place to brute-force
   * access tokens. Ten per minute leaves a real customer unimpeded and makes
   * guessing a 256-bit token pointless twice over.
   */
  @Public()
  @Post('start')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AuditExempt('PaymentIntentService records payment.started with the resolved provider.')
  async start(
    @Body(new ZodValidationPipe(startPaymentSchema)) body: StartPaymentRequest,
    @Req() request: Request,
    @CurrentUser() user: AccessTokenClaims | undefined,
  ) {
    /**
     * Locale is narrowed to the three SAFRA supports (§1.4) rather than passed
     * through. It ends up in a URL handed to a payment provider, so an arbitrary
     * header value has no business reaching it.
     */
    const requested = request.get('accept-language')?.slice(0, 2).toLowerCase();
    const locale = requested === 'en' || requested === 'de' ? requested : 'ar';

    /**
     * `user` is undefined for a guest, which is the normal case on this @Public()
     * route — JwtAuthGuard still decodes a token when one is present. Applying a
     * wallet balance is the one thing here that needs it, and the service refuses
     * rather than silently ignoring the request when it is missing.
     */
    return this.intents.start({
      reference: body.reference,
      accessToken: body.accessToken,
      method: body.method,
      applyWallet: body.applyWallet,
      claims: user,
      locale,
    });
  }

  /**
   * Provider callbacks (EC-002).
   *
   * @Public() by necessity — a gateway cannot hold a SAFRA session. Authentication
   * is the HMAC signature over the raw body, verified inside the provider adapter,
   * and an unverified payload is recorded but never acted upon.
   *
   * Always answers 200 unless the handler genuinely failed. A 4xx would make most
   * providers retry a payload that will never become acceptable, and some disable
   * the endpoint after repeated rejections — losing every later webhook, including
   * the good ones.
   */
  @Public()
  @Post('webhook/:provider')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @AuditExempt(
    'Every delivery is persisted to payment_provider_events, including forged ones, ' +
      'which is a stronger record than an audit row written only on success.',
  )
  async webhook(
    @Param('provider') provider: string,
    @Req() request: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    /**
     * The raw bytes, not the parsed object. Re-serialising changes key order and
     * whitespace, so the digest would never match and verification would have to be
     * abandoned. `rawBody: true` in main.ts is what makes this available.
     */
    const rawBody = request.rawBody?.toString('utf8') ?? '';

    const verdict = await this.webhooks.handle(provider, rawBody, headers);

    // `deferred` asks the provider to retry: the payment row does not exist yet.
    if (verdict === 'deferred') {
      return { received: true, retry: true };
    }

    return { received: true, retry: false };
  }

  /**
   * What a cancellation would refund, per the snapshotted policy (§7.4).
   *
   * Read-only, so support agents can answer "how much do I get back?" — REFUND_READ
   * rather than REFUND_CREATE, since quoting is not issuing.
   */
  @Get(':reference/refund-quote')
  @RequirePermissions(P.REFUND_READ)
  async refundQuote(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    /* Scoped: a quote is the reconnaissance step for a refund and is gated the same way. */
    return this.refunds.quote(reference, user);
  }

  /**
   * Issues a refund (§7.4).
   *
   * REFUND_CREATE belongs to finance only — §4 explicitly denies it to support
   * agents, who must escalate. The amount is NOT accepted from the caller: it is
   * computed from the policy the customer agreed to, so neither a mistake nor a
   * compromised staff account can choose an arbitrary figure.
   */
  /**
   * Finance confirming an OFFLINE refund has actually been sent (finding 222).
   *
   * `REFUND_CREATE`, the same permission that issues one: deciding money goes back and confirming
   * it left are the same responsibility, and a second permission for the second half would be one
   * more thing to get wrong in a role map without protecting anything new.
   *
   * Addressed by the refund's own id rather than by the booking, because a booking may carry
   * several refunds and only some of them settleable. The id is a UUID, so it cannot be walked the
   * way a sequential reference could — and the service answers `not_found` for a refund outside
   * this reader's scope, which is the same answer as one that does not exist.
   */
  @Post('refunds/:refundId/settle')
  @RequirePermissions(P.REFUND_CREATE)
  @AuditExempt('RefundService records refund.settled inside the settlement transaction.')
  async settleRefund(
    @Param('refundId', new ZodValidationPipe(refundIdSchema)) refundId: string,
    @CurrentUser() user: AccessTokenClaims | undefined,
  ) {
    return this.refunds.settle(refundId, user);
  }

  @Post(':reference/refund')
  @RequirePermissions(P.REFUND_CREATE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @AuditExempt('RefundService records refund.created inside the refund transaction.')
  async refund(
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(createRefundSchema)) body: CreateRefundRequest,
    @CurrentUser() user: AccessTokenClaims | undefined,
  ) {
    return this.refunds.execute(reference, body.reason, user);
  }
}
