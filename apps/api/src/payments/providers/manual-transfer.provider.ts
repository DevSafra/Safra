import { Injectable } from '@nestjs/common';

import type {
  CreateIntentInput,
  IntentOutcome,
  NormalisedEvent,
  PaymentProvider,
  RefundInput,
  RefundOutcome,
} from '../payment-provider.port.js';

/**
 * SEPA credit transfer, confirmed by a human (ADR 0002).
 *
 * This is the one rail `Safra Technologies GmbH` can operate with no PSP contract
 * at all, which matters because Stripe and PayPal both bar Syria-originating
 * services regardless of merchant jurisdiction. It is therefore not a placeholder:
 * it is the fallback that lets the platform take money while a card acquirer is
 * still being sourced, and it stays useful afterwards for high-value bookings where
 * card fees and chargeback risk are worst.
 *
 * The customer is given a remittance reference and transfers the money themselves.
 * Finance matches the incoming credit and confirms it through the staff capture
 * endpoint, which is the same path a webhook would take — so the ledger posting and
 * the booking transition are identical either way.
 */
@Injectable()
export class ManualTransferProvider implements PaymentProvider {
  readonly slug = 'manual_transfer';
  readonly supportedMethods = ['bank_transfer'] as const;

  /**
   * The whole point of this flag. An offline rail settles on a bank's timetable,
   * not in the checkout session, so the UI must never imply the booking is paid the
   * moment the customer clicks — and the SLA sweep must allow a longer window than
   * it would for a card.
   */
  readonly isOffline = true;

  /**
   * There is no API call to make, so this only mints the reference the customer
   * must quote. Deriving it from the booking reference is deliberate: finance
   * reconciles against a bank statement by eye, and an opaque UUID in the remittance
   * field makes that job unreasonable.
   *
   * Note this is NOT a secret — it appears on a bank statement, so it authorizes
   * nothing on its own. Authorization for a guest to pay is the booking access
   * token, checked before this is ever reached.
   */
  createIntent(input: CreateIntentInput): Promise<IntentOutcome> {
    const remittanceReference = `SAFRA-${input.bookingReference}`;

    return Promise.resolve({
      kind: 'requires_action',
      providerRef: remittanceReference,
      /**
       * Points at SAFRA's own instructions page rather than a PSP. The page reads
       * the GmbH's bank details from settings (P-005) so finance can change them
       * without a deploy — and so they are not baked into a source file.
       */
      redirectUrl: `${input.returnUrl}?method=bank_transfer&remittance=${encodeURIComponent(
        remittanceReference,
      )}`,
    });
  }

  /**
   * Banks do not send webhooks. Returning null keeps the caller's contract simple:
   * anything arriving at the webhook endpoint claiming to be this provider is by
   * definition forged, gets recorded unverified, and is never acted upon.
   */
  parseWebhook(): NormalisedEvent | null {
    return null;
  }

  /**
   * A SEPA refund is an outbound transfer a human executes, so this can only ever
   * report `processing`. Claiming `completed` here would mark the customer refunded
   * in SAFRA's books before any money left the account — the refund row stays open
   * until finance confirms it, which is the honest state.
   */
  refund(input: RefundInput): Promise<RefundOutcome> {
    return Promise.resolve({
      kind: 'processing',
      providerRef: `SEPA-REFUND-${input.refundId}`,
    });
  }
}
