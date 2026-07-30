import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { BookingActionsService } from '../bookings/booking-actions.service.js';
import { BookingAccessService } from '../bookings/booking-access.service.js';
import { DATABASE } from '../database/database.module.js';
import type { NormalisedEvent } from './payment-provider.port.js';
import { PaymentProviderRegistry } from './providers/provider.registry.js';

/**
 * What the endpoint tells the provider. Deliberately coarse: a PSP only needs to
 * know whether to retry, and a detailed error body would describe SAFRA's internals
 * to anyone who can reach the URL.
 */
export type WebhookVerdict = 'accepted' | 'duplicate' | 'rejected' | 'deferred';

/**
 * Turns a provider's webhook into a state change, exactly once (EC-002).
 *
 * The invariants that matter, and why each is here rather than assumed:
 *
 *  - **Every delivery is recorded, verified or not.** A forged payload is the only
 *    evidence that someone is probing the endpoint; dropping it silently destroys
 *    the trace. Unverified events are stored and never acted upon.
 *  - **Dedupe is a unique index, not a lookup-then-insert.** PSPs retry
 *    aggressively and guarantee at-least-once delivery. A check-then-act would let
 *    two concurrent retries both pass the check and post the ledger twice; the
 *    database rejecting the second insert cannot be raced.
 *  - **An unknown provider reference is deferred, not rejected.** Webhooks routinely
 *    beat the response that created the payment row. Answering "rejected" would make
 *    the provider give up on a capture that is genuinely ours.
 */
@Injectable()
export class PaymentWebhookService {
  private readonly logger = new Logger(PaymentWebhookService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly registry: PaymentProviderRegistry,
    private readonly bookingActions: BookingActionsService,
    private readonly access: BookingAccessService,
  ) {}

  async handle(
    providerSlug: string,
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): Promise<WebhookVerdict> {
    const provider = this.registry.bySlug(providerSlug);

    if (!provider) {
      // Recorded without a parsed shape: the slug itself may be the interesting part.
      await this.record(providerSlug, null, rawBody, false);
      this.logger.warn(`Webhook for unregistered provider "${providerSlug}".`);
      return 'rejected';
    }

    const event = provider.parseWebhook(rawBody, headers);

    if (!event) {
      await this.record(providerSlug, null, rawBody, false);
      return 'rejected';
    }

    /**
     * Claim the event first. If another delivery of the same event already inserted
     * this row, the unique index rejects this one and we stop — before any ledger
     * write, not after.
     */
    const claimed = await this.record(providerSlug, event, rawBody, true);
    if (!claimed) return 'duplicate';

    try {
      const verdict = await this.dispatch(providerSlug, event, claimed);

      await this.db.execute(sql`
        UPDATE payment_provider_events
        SET processed_at = now()
        WHERE id = ${claimed} AND processed_at IS NULL
      `);

      return verdict;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      /**
       * The error is recorded on the event row and re-raised as a 5xx so the
       * provider retries. Swallowing it would leave the booking unpaid with the
       * provider believing SAFRA acknowledged the money.
       */
      await this.db.execute(sql`
        UPDATE payment_provider_events
        SET processing_error = ${message}
        WHERE id = ${claimed}
      `);

      this.logger.error(`Webhook ${event.providerEventId} failed: ${message}`);
      throw error;
    }
  }

  /**
   * Inserts the event, returning its id — or null if it was already seen.
   *
   * `ON CONFLICT DO NOTHING` on `(provider, provider_event_id)` is the entire
   * exactly-once guarantee.
   */
  private async record(
    providerSlug: string,
    event: NormalisedEvent | null,
    rawBody: string,
    signatureVerified: boolean,
  ): Promise<string | null> {
    /**
     * An unverified or unparseable body has no trustworthy event id, so one is
     * synthesised from a digest of the body. That still dedupes identical retries
     * while making it impossible for a forged id to collide with a real event.
     */
    const providerEventId = event?.providerEventId ?? `unverified:${sha256Hex(rawBody)}`;
    const eventType = event?.eventType ?? 'unparsed';

    const rows = await this.db.execute<{ id: string }>(sql`
      INSERT INTO payment_provider_events
        (provider, provider_event_id, event_type, payload, signature_verified)
      VALUES (${providerSlug}, ${providerEventId}, ${eventType},
              ${truncateForStorage(rawBody)}::jsonb, ${signatureVerified})
      ON CONFLICT (provider, provider_event_id) DO NOTHING
      RETURNING id
    `);

    return rows.rows[0]?.id ?? null;
  }

  private async dispatch(
    providerSlug: string,
    event: NormalisedEvent,
    eventRowId: string,
  ): Promise<WebhookVerdict> {
    if (event.outcome === 'ignored') return 'accepted';

    const payment = await this.findPayment(providerSlug, event.providerRef);

    if (!payment) {
      /**
       * Not an error. A webhook can outrun the createIntent response that persists
       * `provider_ref`. Deferring makes the provider retry, by which time the row
       * exists — so the event row is left unprocessed on purpose, as the marker
       * that something is still owed.
       */
      this.logger.warn(
        `Webhook ${event.providerEventId} references unknown payment ` +
          `${providerSlug}/${event.providerRef}; deferring for retry.`,
      );
      return 'deferred';
    }

    await this.db.execute(sql`
      UPDATE payment_provider_events SET payment_id = ${payment.id} WHERE id = ${eventRowId}
    `);

    switch (event.outcome) {
      case 'captured':
        return this.applyCapture(payment, event);
      case 'authorized':
        return this.applyAuthorized(payment);
      case 'failed':
      case 'expired':
        return this.applyTerminal(payment, event);
      case 'refunded':
        return this.applyRefundConfirmation(payment, event);
      default:
        return 'accepted';
    }
  }

  /**
   * The money arrived.
   *
   * Amount is re-checked against SAFRA's own record before anything is posted. A
   * provider reporting a different figure than the booking's total means either a
   * partial payment or a mismatched reference, and posting a ledger group from the
   * provider's number would let an attacker who can forge one webhook decide what a
   * stay cost.
   */
  private async applyCapture(
    payment: PaymentRow,
    event: NormalisedEvent,
  ): Promise<WebhookVerdict> {
    if (event.amount && !amountsEqual(event.amount.value, payment.amount)) {
      this.logger.error(
        `Webhook ${event.providerEventId} reports ${event.amount.value} for payment ` +
          `${payment.reference} recorded as ${payment.amount}; refusing to capture.`,
      );
      return 'rejected';
    }

    if (payment.status === 'captured') return 'accepted';

    if (event.feeAmount) {
      await this.db.execute(sql`
        UPDATE payments SET provider_fee_amount = ${event.feeAmount} WHERE id = ${payment.id}
      `);
    }

    /**
     * Delegated rather than reimplemented. `markPaid` owns the state-machine guard,
     * the confirmation-window reset and the four-leg ledger posting, all in one
     * transaction — duplicating any of that here is how the two paths drift.
     */
    await this.bookingActions.markPaid(payment.booking_reference, undefined, payment.id);

    /**
     * The guest's payment token has served its purpose. Leaving it live past capture
     * is a credential outliving the operation it authorized.
     */
    await this.access.revoke(this.db, payment.booking_id);

    return 'accepted';
  }

  private async applyAuthorized(payment: PaymentRow): Promise<WebhookVerdict> {
    // Authorised-but-not-captured holds no money, so the booking does not advance.
    await this.db.execute(sql`
      UPDATE payments
      SET status = 'authorized'::payment_status, authorized_at = now(), updated_at = now()
      WHERE id = ${payment.id} AND status IN ('initiated','requires_action')
    `);

    return 'accepted';
  }

  /**
   * The attempt is over without money.
   *
   * The BOOKING is deliberately left in `pending_payment`: the dates stay held for
   * the rest of the window so the customer can retry with another card. EC-001's
   * sweep is what releases them, and it is the single owner of that decision.
   */
  private async applyTerminal(
    payment: PaymentRow,
    event: NormalisedEvent,
  ): Promise<WebhookVerdict> {
    const status = event.outcome === 'expired' ? 'expired' : 'failed';

    await this.db.execute(sql`
      UPDATE payments
      SET status = ${status}::payment_status,
          failed_at = now(),
          failure_reason = ${event.reason ?? 'Reported unsuccessful by the provider.'},
          updated_at = now()
      WHERE id = ${payment.id} AND status IN ('initiated','requires_action','authorized')
    `);

    return 'accepted';
  }

  /** A refund SAFRA initiated has settled at the provider. */
  private async applyRefundConfirmation(
    payment: PaymentRow,
    event: NormalisedEvent,
  ): Promise<WebhookVerdict> {
    await this.db.execute(sql`
      UPDATE refunds
      SET status = 'completed'::refund_status, completed_at = now(), updated_at = now()
      WHERE payment_id = ${payment.id}
        AND status IN ('pending','processing')
        AND (${event.amount?.value ?? null}::numeric IS NULL
             OR amount = ${event.amount?.value ?? null}::numeric)
    `);

    return 'accepted';
  }

  private async findPayment(
    providerSlug: string,
    providerRef: string,
  ): Promise<PaymentRow | null> {
    const rows = await this.db.execute<PaymentRow>(sql`
      SELECT p.id, p.reference, p.status::text AS status, p.amount::text AS amount,
             p.booking_id, b.reference AS booking_reference
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      WHERE p.provider = ${providerSlug} AND p.provider_ref = ${providerRef}
      LIMIT 1
    `);

    return rows.rows[0] ?? null;
  }
}

/**
 * A `type` rather than an `interface` on purpose: Drizzle's `execute<T>` constrains
 * T to `Record<string, unknown>`, and TypeScript infers an implicit index signature
 * for type aliases but not for interfaces.
 */
type PaymentRow = {
  id: string;
  reference: string;
  status: string;
  amount: string;
  booking_id: string;
  booking_reference: string;
};

/**
 * Exact decimal comparison. `Number()` on money is what turns 0.145 into 0.14499999
 * and makes a legitimate capture look like a mismatch.
 */
function amountsEqual(a: string, b: string): boolean {
  const normalise = (v: string): string => {
    const [whole = '0', fraction = ''] = v.trim().split('.');
    return `${whole.replace(/^\+?0+(?=\d)/, '')}.${fraction.padEnd(2, '0').slice(0, 2)}`;
  };

  return normalise(a) === normalise(b);
}

/**
 * Caps what a stranger can write to the database in one request.
 *
 * The endpoint is unauthenticated by nature — a signature is checked, but only
 * after the body has been read — so an oversized payload must not become an
 * unbounded insert. Kept as a JSON string so the column stays valid jsonb.
 */
const MAX_STORED_PAYLOAD_BYTES = 64 * 1024;

function truncateForStorage(rawBody: string): string {
  if (Buffer.byteLength(rawBody, 'utf8') <= MAX_STORED_PAYLOAD_BYTES) {
    // Re-wrapped only if it is not already valid JSON, so a real payload is stored
    // verbatim and remains queryable.
    try {
      JSON.parse(rawBody);
      return rawBody;
    } catch {
      return JSON.stringify({ unparsed: rawBody.slice(0, 4096) });
    }
  }

  return JSON.stringify({
    truncated: true,
    bytes: Buffer.byteLength(rawBody, 'utf8'),
    head: rawBody.slice(0, 4096),
  });
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
