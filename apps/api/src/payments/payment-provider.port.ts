/**
 * The contract every payment gateway must satisfy (ADR 0002).
 *
 * This port exists because the gateway is genuinely undecided: the merchant entity
 * is `Safra Technologies GmbH`, but Stripe and PayPal both prohibit services
 * originating from Syria irrespective of merchant jurisdiction, so which PSP will
 * underwrite SAFRA is an open commercial question. Committing to one SDK's shapes
 * would make that answer a refactor instead of a config change.
 *
 * The interface is deliberately shaped around the *hardest* rail rather than the
 * easiest one — a PSD2/SCA card payment that suspends mid-flow for a 3-D Secure
 * challenge and completes out-of-band via webhook. A synchronous "charge now"
 * design cannot express that, and every simpler rail (bank transfer, wallet) fits
 * inside the async shape trivially. Designing for the simple case first would
 * guarantee the rewrite.
 *
 * No gateway SDK may be imported outside `./providers/`.
 */

/** Minor-unit integers only. Floats never touch money — see @safra/money. */
export interface PaymentAmount {
  /** Decimal string, e.g. "221.99". Exact; never a number. */
  readonly value: string;
  readonly currencyCode: string;
}

export interface CreateIntentInput {
  /** SAFRA's own payment row id, used as the provider's idempotency key. */
  readonly paymentId: string;
  readonly bookingReference: string;
  readonly amount: PaymentAmount;
  /** Where the PSP returns the customer after a challenge or hosted page. */
  readonly returnUrl: string;
  /** Passed through to the PSP for its own fraud signals; never used for auth. */
  readonly customerEmail: string;
  readonly locale: string;
}

/**
 * The three ways a payment attempt can legitimately end up after creation.
 *
 * `requires_action` is the one that matters: it means the customer must be sent
 * somewhere (a 3-D Secure challenge, a hosted page, a wallet app) before anything
 * is captured. Collapsing it into "pending" is what causes platforms to treat a
 * mid-challenge payment as a failed one.
 */
export type IntentOutcome =
  | {
      readonly kind: 'requires_action';
      readonly providerRef: string;
      readonly redirectUrl: string;
    }
  | { readonly kind: 'authorized'; readonly providerRef: string }
  | {
      readonly kind: 'captured';
      readonly providerRef: string;
      readonly feeAmount?: string;
    }
  | { readonly kind: 'failed'; readonly providerRef?: string; readonly reason: string };

/**
 * A webhook the provider sent, already signature-verified and normalised.
 *
 * `providerEventId` is mandatory because it is the dedupe key: PSPs guarantee
 * at-least-once delivery, so without it a retried capture posts the ledger twice.
 */
export interface NormalisedEvent {
  readonly providerEventId: string;
  readonly eventType: string;
  /** Maps back to `payments.provider_ref`. */
  readonly providerRef: string;
  readonly outcome:
    'captured' | 'authorized' | 'failed' | 'expired' | 'refunded' | 'ignored';
  readonly amount?: PaymentAmount;
  readonly feeAmount?: string;
  readonly reason?: string;
}

export interface RefundInput {
  readonly paymentProviderRef: string;
  readonly amount: PaymentAmount;
  /** SAFRA's refund row id, used as the provider's idempotency key. */
  readonly refundId: string;
  readonly reason: string;
}

export type RefundOutcome =
  | { readonly kind: 'completed'; readonly providerRef: string }
  | { readonly kind: 'processing'; readonly providerRef: string }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * Raised when a provider cannot be reached or answers unusably.
 *
 * Distinct from a *declined* payment: a decline is a business outcome the customer
 * must see, an outage is an operational fault they must be told to retry. Mapping
 * both to one error is how platforms end up telling solvent customers their card
 * was refused.
 */
export class PaymentProviderUnavailableError extends Error {
  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentProviderUnavailableError';
  }
}

export interface PaymentProvider {
  /** Stable slug persisted on `payments.provider`; refunds route back by it. */
  readonly slug: string;

  /** Which rails this provider can actually serve. */
  readonly supportedMethods: readonly string[];

  /**
   * True when the provider settles money without an API call — bank transfer,
   * cash. Such payments are confirmed by staff, so they must never be presented
   * to a customer as instantly payable.
   */
  readonly isOffline: boolean;

  createIntent(input: CreateIntentInput): Promise<IntentOutcome>;

  /**
   * Verifies the signature and normalises the body, or returns null.
   *
   * Returning null (rather than throwing) for an unverifiable payload is
   * deliberate: the caller still records the attempt for investigation, which is
   * the only evidence that someone is probing the endpoint.
   */
  parseWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): NormalisedEvent | null;

  refund(input: RefundInput): Promise<RefundOutcome>;
}
