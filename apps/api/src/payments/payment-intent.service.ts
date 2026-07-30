import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';
import { BookingAccessService } from '../bookings/booking-access.service.js';
import type { IntentOutcome } from './payment-provider.port.js';
import { PaymentProviderUnavailableError } from './payment-provider.port.js';
import { PaymentProviderRegistry } from './providers/provider.registry.js';

/** Statuses from which a fresh payment attempt is legitimate. */
const PAYABLE_BOOKING_STATUSES = ['pending_payment'];

/** Attempts we can reuse rather than replace. */
const REUSABLE_PAYMENT_STATUSES = ['initiated', 'requires_action'];

export interface StartPaymentInput {
  readonly reference: string;
  readonly accessToken: string;
  /** Preferred rail. Advisory — routing decides what is actually possible. */
  readonly method?: string | undefined;
  readonly locale: string;
}

export interface StartPaymentResult {
  readonly reference: string;
  readonly paymentReference: string;
  readonly status: 'requires_action' | 'authorized' | 'captured' | 'failed';
  readonly redirectUrl?: string;
  readonly offline: boolean;
  readonly amount: { value: string; currencyCode: string };
}

/**
 * Starts a payment attempt against an existing booking (SRS §6.3 step 4, §7.1).
 *
 * Three properties this service exists to guarantee:
 *
 *  1. **The amount comes from the booking, never from the client.** A client-supplied
 *     price is the oldest e-commerce vulnerability there is, and the booking already
 *     snapshotted its own total at creation.
 *  2. **A guest must present the booking access token.** References are sequential
 *     (§13.2), so without it anyone could pay for — and read the total of — a
 *     stranger's booking.
 *  3. **Retrying is safe.** A customer who reloads the payment page, or whose
 *     connection drops mid-redirect, reuses the open attempt instead of creating a
 *     second one. Two open attempts against one booking is how double charges happen.
 */
@Injectable()
export class PaymentIntentService {
  private readonly logger = new Logger(PaymentIntentService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly access: BookingAccessService,
    private readonly registry: PaymentProviderRegistry,
    private readonly audit: AuditService,
  ) {}

  /**
   * Where the provider sends the customer back.
   *
   * Built from configured `APP_URL`, never from the request. Taking it from a
   * header would be an open redirect — and one handed to a payment provider is a
   * phishing page reached through SAFRA's own gateway. It must also point at the
   * WEB app, not the API host that served this request.
   */
  private returnUrl(locale: string): string {
    return new URL(`/${locale}/payments/return`, this.env.APP_URL).toString();
  }

  async start(input: StartPaymentInput): Promise<StartPaymentResult> {
    // 404s on a bad reference OR a bad token, indistinguishably.
    const booking = await this.access.authorize(input.reference, input.accessToken);

    if (!PAYABLE_BOOKING_STATUSES.includes(booking.status)) {
      /**
       * Deliberately states the status. Unlike an enumeration probe, the caller has
       * already proved they hold this booking's token, and "already paid" versus
       * "expired" is exactly what they need to know to act.
       */
      throw new ConflictException(
        `This booking is ${booking.status.replace(/_/g, ' ')} and cannot be paid.`,
      );
    }

    const context = await this.loadPaymentContext(booking.id);

    /**
     * Reuse before create. The provider reference is derived from the payment id,
     * so handing back the same attempt yields the same reference at the gateway —
     * which is what makes a reload idempotent rather than a second authorisation.
     */
    const existing = context.openPaymentId ? await this.reuse(context, input) : undefined;

    if (existing) return existing;

    const provider = await this.registry.resolveForCountry(
      context.countryCode,
      input.method,
    );

    /**
     * The rail actually used, recorded on the payment.
     *
     * The requested method wins when the resolved provider supports it; otherwise
     * the provider's own first rail does. Routing has already guaranteed one of
     * those holds, so this cannot silently record a method the provider never
     * served — which would misdirect a refund and misreport the rail mix.
     */
    const method = resolveMethod(provider.supportedMethods, input.method);

    const paymentId = await this.createPaymentRow(
      booking.id,
      provider.slug,
      method,
      context,
    );

    let outcome;
    try {
      outcome = await provider.createIntent({
        paymentId,
        bookingReference: booking.reference,
        amount: { value: context.totalAmount, currencyCode: context.currencyCode },
        returnUrl: this.returnUrl(input.locale),
        customerEmail: context.email,
        locale: input.locale,
      });
    } catch (error) {
      await this.markFailed(paymentId, describeProviderFault(error));

      /**
       * An outage is not a decline. Surfacing it as one would tell a solvent
       * customer their card was refused, and they would stop retrying.
       */
      if (error instanceof PaymentProviderUnavailableError) {
        this.logger.error(`Provider ${error.provider} unavailable: ${error.message}`);
        throw new ConflictException('Payment is temporarily unavailable. Please retry.');
      }

      throw error;
    }

    return this.persistOutcome(paymentId, provider.slug, provider.isOffline, outcome, {
      booking,
      context,
    });
  }

  /**
   * Everything needed to price and route the attempt, in one query.
   *
   * Joined rather than fetched per-entity: this is the checkout hot path, and four
   * round trips to render one page is how a p95 budget is missed (§3).
   */
  private async loadPaymentContext(bookingId: string): Promise<PaymentContext> {
    const rows = await this.db.execute<{
      total_amount: string;
      currency_id: string;
      currency_code: string;
      country_code: string;
      email: string;
      expires_at: string | null;
      open_payment_id: string | null;
      open_payment_provider: string | null;
    }>(sql`
      SELECT b.total_amount::text     AS total_amount,
             b.currency_id,
             cur.code                 AS currency_code,
             co.code                  AS country_code,
             cp.email,
             b.confirmation_deadline_at::text AS expires_at,
             p.id                     AS open_payment_id,
             p.provider               AS open_payment_provider
      FROM bookings b
      JOIN currencies cur       ON cur.id = b.currency_id
      JOIN cities ci            ON ci.id = b.city_id
      JOIN countries co         ON co.id = ci.country_id
      JOIN customer_profiles cp ON cp.id = b.customer_profile_id
      LEFT JOIN payments p
        ON p.booking_id = b.id
       AND p.status IN ('initiated','requires_action')
       AND p.deleted_at IS NULL
      WHERE b.id = ${bookingId}
      ORDER BY p.created_at DESC
      LIMIT 1
    `);

    const row = rows.rows[0];
    if (!row) throw new ConflictException('This booking can no longer be paid.');

    return {
      totalAmount: row.total_amount,
      currencyId: row.currency_id,
      currencyCode: row.currency_code,
      countryCode: row.country_code,
      email: row.email,
      expiresAt: row.expires_at,
      openPaymentId: row.open_payment_id,
      openPaymentProvider: row.open_payment_provider,
    };
  }

  /**
   * Hands back an already-open attempt.
   *
   * Only for a provider still registered and still holding a usable reference. If
   * either has changed, the old attempt is abandoned and a new one is created —
   * resuming into a provider that has since been disabled would strand the customer.
   */
  private async reuse(
    context: PaymentContext,
    input: StartPaymentInput,
  ): Promise<StartPaymentResult | undefined> {
    const slug = context.openPaymentProvider;
    const paymentId = context.openPaymentId;
    if (!slug || !paymentId) return undefined;

    const provider = this.registry.bySlug(slug);
    if (!provider) return undefined;

    const rows = await this.db.execute<{
      reference: string;
      provider_ref: string | null;
      status: string;
    }>(sql`
      SELECT reference, provider_ref, status::text AS status
      FROM payments WHERE id = ${paymentId}
    `);

    const payment = rows.rows[0];
    if (!payment || !REUSABLE_PAYMENT_STATUSES.includes(payment.status)) return undefined;

    /**
     * Re-issued rather than stored. A redirect URL can embed a short-lived
     * provider token, so replaying a persisted one is how customers land on an
     * expired gateway page; asking the provider again always yields a fresh one.
     */
    const outcome = await provider.createIntent({
      paymentId,
      bookingReference: input.reference,
      amount: { value: context.totalAmount, currencyCode: context.currencyCode },
      returnUrl: this.returnUrl(input.locale),
      customerEmail: context.email,
      locale: input.locale,
    });

    if (outcome.kind === 'failed') return undefined;

    return {
      reference: input.reference,
      paymentReference: payment.reference,
      status: outcome.kind,
      ...(outcome.kind === 'requires_action' ? { redirectUrl: outcome.redirectUrl } : {}),
      offline: provider.isOffline,
      amount: { value: context.totalAmount, currencyCode: context.currencyCode },
    };
  }

  private async createPaymentRow(
    bookingId: string,
    providerSlug: string,
    method: string,
    context: PaymentContext,
  ): Promise<string> {
    const rows = await this.db.execute<{ id: string }>(sql`
      INSERT INTO payments
        (booking_id, method, provider, amount, currency_id, status, expires_at)
      VALUES (${bookingId}, ${method}::payment_method, ${providerSlug},
              ${context.totalAmount}, ${context.currencyId},
              'initiated'::payment_status, ${context.expiresAt})
      RETURNING id
    `);

    const id = rows.rows[0]?.id;
    if (!id) throw new Error('Payment insert returned no row.');

    return id;
  }

  private async persistOutcome(
    paymentId: string,
    providerSlug: string,
    offline: boolean,
    outcome: IntentOutcome,
    subject: { booking: { id: string; reference: string }; context: PaymentContext },
  ): Promise<StartPaymentResult> {
    const { booking, context } = subject;

    if (outcome.kind === 'failed') {
      await this.markFailed(paymentId, outcome.reason);

      await this.audit.record({
        action: 'payment.failed',
        subjectType: 'booking',
        subjectId: booking.id,
        after: { provider: providerSlug, reason: outcome.reason },
      });

      return {
        reference: booking.reference,
        paymentReference: await this.paymentReference(paymentId),
        status: 'failed',
        offline,
        amount: { value: context.totalAmount, currencyCode: context.currencyCode },
      };
    }

    /**
     * `captured` is NOT applied here even if a provider claims it synchronously.
     * Capture must flow through the webhook path so that the ledger posting has
     * exactly one entry point — two paths to "money received" is how books end up
     * with a movement recorded twice or not at all.
     */
    const status = outcome.kind === 'requires_action' ? 'requires_action' : 'authorized';

    await this.db.execute(sql`
      UPDATE payments
      SET status = ${status}::payment_status,
          provider_ref = ${outcome.providerRef},
          authorized_at = CASE WHEN ${status} = 'authorized' THEN now() ELSE authorized_at END,
          updated_at = now()
      WHERE id = ${paymentId}
    `);

    await this.audit.record({
      action: 'payment.started',
      subjectType: 'booking',
      subjectId: booking.id,
      after: {
        provider: providerSlug,
        status,
        amount: context.totalAmount,
        currency: context.currencyCode,
      },
    });

    return {
      reference: booking.reference,
      paymentReference: await this.paymentReference(paymentId),
      status,
      ...(outcome.kind === 'requires_action' ? { redirectUrl: outcome.redirectUrl } : {}),
      offline,
      amount: { value: context.totalAmount, currencyCode: context.currencyCode },
    };
  }

  private async markFailed(paymentId: string, reason: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE payments
      SET status = 'failed'::payment_status,
          failed_at = now(),
          failure_reason = ${reason},
          updated_at = now()
      WHERE id = ${paymentId}
    `);
  }

  private async paymentReference(paymentId: string): Promise<string> {
    const rows = await this.db.execute<{ reference: string }>(sql`
      SELECT reference FROM payments WHERE id = ${paymentId}
    `);

    return rows.rows[0]?.reference ?? '';
  }
}

interface PaymentContext {
  readonly totalAmount: string;
  readonly currencyId: string;
  readonly currencyCode: string;
  readonly countryCode: string;
  readonly email: string;
  readonly expiresAt: string | null;
  readonly openPaymentId: string | null;
  readonly openPaymentProvider: string | null;
}

/**
 * Picks the rail to record for an attempt.
 *
 * Falls back to the provider's first supported method rather than to a hardcoded
 * card. A literal default would quietly label a Klarna or Sham Cash payment as
 * `visa`, and every downstream report of the rail mix would be wrong.
 */
function resolveMethod(
  supported: readonly string[],
  requested: string | undefined,
): string {
  if (requested && supported.includes(requested)) return requested;

  const fallback = supported[0];
  if (!fallback) {
    // Unreachable via routing, which only returns providers declaring a method.
    throw new Error('Payment provider declares no supported methods.');
  }

  return fallback;
}

/**
 * Provider faults are logged in full and stored in a generic form.
 *
 * `failure_reason` is staff-visible, so a raw gateway string with a merchant id or
 * internal endpoint in it must not land there (rule 1).
 */
function describeProviderFault(error: unknown): string {
  if (error instanceof PaymentProviderUnavailableError) {
    return `Provider ${error.provider} was unreachable.`;
  }

  return 'The payment provider returned an unexpected error.';
}
