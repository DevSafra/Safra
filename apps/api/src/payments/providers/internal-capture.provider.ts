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
 * The rail behind money staff recorded by hand — so that it can be given back.
 *
 * ## What was broken
 *
 * `BookingActionsService.createInternalPayment` writes `provider = 'internal'` for a capture with
 * no gateway behind it: finance took the money offline and a staff member marked the booking paid.
 * The slug was deliberately absent from the registry, and the comment explaining why was about
 * TAKING money — there is no acquirer to ask for an authorisation.
 *
 * Refunds route back through whichever provider took the money, by that same slug. So a booking
 * captured this way could never be refunded: the quote answered 200, the console offered
 * «استرداد» because the booking was paid, and the API answered **409 payment.refund_unavailable**
 * for ever. 146 bookings and $29,480.54 were in that state, and each one is a customer who cannot
 * be given their money back.
 *
 * ## Why the answer is `processing` rather than `completed`
 *
 * The same answer `ManualTransferProvider` gives, for the same reason: nobody has sent anything
 * yet. An offline rail settles on a human's timetable, so the refund is RECORDED and waits, and
 * finance confirms it when the transfer goes out. Answering `completed` here would tell a customer
 * their money was on its way when no instruction existed anywhere.
 *
 * ## It takes no new money, ever
 *
 * `acceptsNewPayments = false` keeps it out of `availableSlugs()`, which is what the settings
 * screen offers as a routing target. Registering it to fix refunds must not make it selectable as
 * a way to charge somebody — the capture path here is a staff action on a booking, never a
 * checkout. `createIntent` refuses rather than returning something plausible.
 */
@Injectable()
export class InternalCaptureProvider implements PaymentProvider {
  readonly slug = 'internal';

  /** Nothing. It is never a checkout option; see the note above. */
  readonly supportedMethods = [] as const;

  readonly isOffline = true;

  readonly acceptsNewPayments = false;

  createIntent(_input: CreateIntentInput): Promise<IntentOutcome> {
    /* Internal, never client-facing: a caller reaching this has routed a checkout wrongly. */
    return Promise.reject(
      new Error('An internal capture is recorded by staff and has no payment intent.'),
    );
  }

  /** Banks and cash drawers do not send webhooks — anything claiming to is forged. */
  parseWebhook(): NormalisedEvent | null {
    return null;
  }

  refund(input: RefundInput): Promise<RefundOutcome> {
    return Promise.resolve({
      kind: 'processing',
      providerRef: `MANUAL-REFUND-${input.refundId}`,
    });
  }
}
