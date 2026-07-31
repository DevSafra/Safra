import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';
import { MONEY_SCALE, fromMinor, toMinor } from '../common/money.js';
import { BookingAccessService } from '../bookings/booking-access.service.js';
import { BookingActionsService } from '../bookings/booking-actions.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
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
  /**
   * Apply the customer's stored balance to this booking (§7.3).
   *
   * A boolean, NOT an amount. How much to apply is derived server-side from the
   * balance and the total; accepting a figure would be accepting a client-supplied
   * price by another name.
   */
  readonly applyWallet?: boolean | undefined;
  /** The signed-in customer, when there is one. Required to apply a balance. */
  readonly claims?: AccessTokenClaims | undefined;
}

export interface StartPaymentResult {
  readonly reference: string;
  readonly paymentReference: string;
  readonly status: 'requires_action' | 'authorized' | 'captured' | 'failed';
  readonly redirectUrl?: string;
  readonly offline: boolean;
  /** What the gateway is being asked for — the total less any stored value. */
  readonly amount: { value: string; currencyCode: string };
  /** Stored value funding this booking, for the customer's breakdown. */
  readonly walletApplied: string;
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
    private readonly wallet: WalletService,
    private readonly actions: BookingActionsService,
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

    /**
     * How much stored value to add, on top of anything already held.
     *
     * Resolved before the provider is chosen because it decides whether a provider
     * is needed at all — a balance covering the whole total means no gateway, no
     * redirect, and nothing for the customer to do.
     */
    const toApply = await this.resolveWalletApplication(input, context, booking);
    const dueMinor = context.dueMinor - toApply;

    if (dueMinor === 0n) {
      return this.captureFromWalletAlone(input, context, booking, toApply);
    }

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

    const due = fromMinor(dueMinor, MONEY_SCALE);

    const paymentId = await this.createPaymentRow(
      booking.id,
      provider.slug,
      method,
      context,
      due,
    );

    let outcome;
    try {
      outcome = await provider.createIntent({
        paymentId,
        bookingReference: booking.reference,
        // The reduced amount, not the booking total. Asking the gateway for the
        // full price and separately debiting the wallet would charge twice.
        amount: { value: due, currencyCode: context.currencyCode },
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

    /**
     * The hold is taken AFTER the gateway has accepted the intent, never before.
     *
     * Ordering it the other way round would strand a customer's balance every time
     * a provider was briefly unreachable: money gone from the wallet, no payment to
     * show for it, and a release path that only runs when the booking eventually
     * expires. Nothing has been debited on any path that reaches the `catch` above.
     */
    if (toApply > 0n) {
      await this.holdWallet(booking, context, toApply, paymentId);
    }

    return this.persistOutcome(paymentId, provider.slug, provider.isOffline, outcome, {
      booking,
      context,
      due,
      walletApplied: fromMinor(context.walletMinor + toApply, MONEY_SCALE),
    });
  }

  /**
   * How much stored value to add to this booking, in minor units.
   *
   * Returns zero unless every condition holds, and never throws for a customer who
   * simply has no balance — an empty wallet is not an error, and failing checkout
   * over it would be worse than ignoring the request.
   */
  private async resolveWalletApplication(
    input: StartPaymentInput,
    context: PaymentContext,
    booking: { customerProfileId: string },
  ): Promise<bigint> {
    if (input.applyWallet !== true) return 0n;

    /**
     * Applied at most once per booking. A second attempt reuses the existing hold
     * rather than adding to it, so a customer reloading the payment page cannot
     * drain their balance across repeated attempts.
     */
    if (context.walletMinor > 0n) return 0n;

    /**
     * **A booking access token is not proof of wallet ownership.**
     *
     * The token proves possession of ONE booking; the wallet spans every booking on
     * the customer profile and may hold compensation earned elsewhere. Someone who
     * came by a single token — a forwarded confirmation email, a shared device —
     * could otherwise spend a balance that booking never contributed to. So this
     * path requires a real session whose profile matches, and a guest is simply
     * offered no balance rather than being told one exists.
     */
    const signedInProfile = input.claims?.customerProfileId;

    if (!signedInProfile || signedInProfile !== booking.customerProfileId) {
      throw new ForbiddenException(
        'Sign in to the account that holds this booking to use your balance.',
      );
    }

    const wallet = await this.wallet.findByCustomer(booking.customerProfileId);
    if (!wallet) return 0n;

    /**
     * Only a balance in the booking's own currency is offered.
     *
     * `WalletService` can convert, but doing it silently here would quote the
     * customer a figure that moves with the FX rate between page load and payment.
     * Cross-currency application needs a quoted, held rate, which is its own piece
     * of work.
     */
    if (wallet.currencyId !== context.currencyId) {
      this.logger.log(
        `Wallet for ${booking.customerProfileId} is held in ${wallet.currencyCode} ` +
          `but ${booking.customerProfileId ? context.currencyCode : ''} is due; ` +
          `not offering it.`,
      );
      return 0n;
    }

    const available = toMinor(wallet.balance, MONEY_SCALE);

    // Never more than the booking costs — the surplus stays spendable elsewhere.
    return available < context.dueMinor ? available : context.dueMinor;
  }

  /**
   * Debits the wallet and records the hold on the booking, atomically.
   *
   * If the balance moved between the quote and here, the debit refuses and this
   * marks the attempt failed rather than letting the customer proceed to a gateway
   * expecting a reduced amount that nothing is covering.
   */
  private async holdWallet(
    booking: { id: string; reference: string; customerProfileId: string },
    context: PaymentContext,
    amountMinor: bigint,
    paymentId: string,
  ): Promise<void> {
    const amount = fromMinor(amountMinor, MONEY_SCALE);

    try {
      await this.db.transaction(async (tx) => {
        await this.wallet.debit(tx as unknown as Database, {
          customerProfileId: booking.customerProfileId,
          amount,
          currencyId: context.currencyId,
          reason: 'booking_payment',
          bookingId: booking.id,
          note: `Applied to ${booking.reference}`,
        });

        await tx.execute(sql`
          UPDATE bookings
          SET wallet_amount = wallet_amount + ${amount}::numeric, updated_at = now()
          WHERE id = ${booking.id}
        `);
      });
    } catch (error) {
      await this.markFailed(paymentId, 'Wallet balance was no longer available.');

      this.logger.warn(
        `Wallet hold of ${amount} for ${booking.reference} failed: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );

      throw new ConflictException(
        'Your balance changed while this payment was being prepared. Please try again.',
      );
    }
  }

  /**
   * A booking paid entirely from stored value.
   *
   * No provider is involved at all, which is why this is a separate path rather
   * than a zero-amount intent: there is no gateway to redirect to, no webhook
   * coming, and asking an acquirer to authorise 0.00 is not a thing. Capture still
   * routes through `markPaid`, so the ledger posting keeps exactly one entry point.
   */
  private async captureFromWalletAlone(
    input: StartPaymentInput,
    context: PaymentContext,
    booking: { id: string; reference: string; customerProfileId: string },
    amountMinor: bigint,
  ): Promise<StartPaymentResult> {
    const amount = fromMinor(amountMinor, MONEY_SCALE);

    const paymentId = await this.createWalletPaymentRow(booking.id, context, amount);

    await this.holdWallet(booking, context, amountMinor, paymentId);

    await this.actions.markPaid(booking.reference, input.claims, paymentId);

    await this.audit.record({
      actorUserId: input.claims?.sub,
      action: 'payment.started',
      subjectType: 'booking',
      subjectId: booking.id,
      after: {
        provider: 'internal',
        status: 'captured',
        walletApplied: amount,
        currency: context.currencyCode,
      },
    });

    return {
      reference: booking.reference,
      paymentReference: await this.paymentReference(paymentId),
      status: 'captured',
      offline: false,
      amount: { value: '0.00', currencyCode: context.currencyCode },
      walletApplied: fromMinor(context.walletMinor + amountMinor, MONEY_SCALE),
    };
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
      wallet_amount: string;
      currency_id: string;
      currency_code: string;
      country_code: string;
      email: string;
      expires_at: string | null;
      open_payment_id: string | null;
      open_payment_provider: string | null;
    }>(sql`
      SELECT b.total_amount::text     AS total_amount,
             b.wallet_amount::text    AS wallet_amount,
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

    const walletMinor = toMinor(row.wallet_amount, MONEY_SCALE);

    return {
      totalAmount: row.total_amount,
      walletMinor,
      // What still needs paying: the gross total less stored value already held.
      dueMinor: toMinor(row.total_amount, MONEY_SCALE) - walletMinor,
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
      amount: string;
    }>(sql`
      SELECT reference, provider_ref, status::text AS status, amount::text AS amount
      FROM payments WHERE id = ${paymentId}
    `);

    const payment = rows.rows[0];
    if (!payment || !REUSABLE_PAYMENT_STATUSES.includes(payment.status)) return undefined;

    /**
     * Re-issued rather than stored. A redirect URL can embed a short-lived
     * provider token, so replaying a persisted one is how customers land on an
     * expired gateway page; asking the provider again always yields a fresh one.
     */
    /**
     * The amount already recorded on the attempt, not a freshly computed one.
     *
     * A reused attempt carries whatever it was opened for, including any wallet
     * reduction applied at the time. Recomputing here would let a balance change
     * silently move the figure the gateway was asked for, so the two would disagree
     * about the same payment reference.
     */
    const due = payment.amount;

    const outcome = await provider.createIntent({
      paymentId,
      bookingReference: input.reference,
      amount: { value: due, currencyCode: context.currencyCode },
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
      amount: { value: due, currencyCode: context.currencyCode },
      walletApplied: fromMinor(context.walletMinor, MONEY_SCALE),
    };
  }

  private async createPaymentRow(
    bookingId: string,
    providerSlug: string,
    method: string,
    context: PaymentContext,
    amount: string,
  ): Promise<string> {
    const rows = await this.db.execute<{ id: string }>(sql`
      INSERT INTO payments
        (booking_id, method, provider, amount, currency_id, status, expires_at)
      VALUES (${bookingId}, ${method}::payment_method, ${providerSlug},
              ${amount}, ${context.currencyId},
              'initiated'::payment_status, ${context.expiresAt})
      RETURNING id
    `);

    const id = rows.rows[0]?.id;
    if (!id) throw new Error('Payment insert returned no row.');

    return id;
  }

  /**
   * The payment row for a booking settled entirely from stored value.
   *
   * `provider = 'internal'` marks it as having no acquirer behind it, the same
   * convention `BookingActionsService` uses for a simulated capture — so
   * reconciliation against a settlement file can tell internal movements from money
   * a PSP actually remitted. Inserted as `initiated` and captured by `markPaid`,
   * rather than written straight to `captured`, so the state change and its ledger
   * posting stay in one place.
   */
  private async createWalletPaymentRow(
    bookingId: string,
    context: PaymentContext,
    amount: string,
  ): Promise<string> {
    const rows = await this.db.execute<{ id: string }>(sql`
      INSERT INTO payments
        (booking_id, method, provider, amount, currency_id, status, expires_at)
      VALUES (${bookingId}, 'wallet'::payment_method, 'internal',
              ${amount}, ${context.currencyId},
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
    subject: {
      booking: { id: string; reference: string };
      context: PaymentContext;
      due: string;
      walletApplied: string;
    },
  ): Promise<StartPaymentResult> {
    const { booking, context, due, walletApplied } = subject;

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
        amount: { value: due, currencyCode: context.currencyCode },
        walletApplied,
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
        amount: due,
        walletApplied,
        currency: context.currencyCode,
      },
    });

    return {
      reference: booking.reference,
      paymentReference: await this.paymentReference(paymentId),
      status,
      ...(outcome.kind === 'requires_action' ? { redirectUrl: outcome.redirectUrl } : {}),
      offline,
      amount: { value: due, currencyCode: context.currencyCode },
      walletApplied,
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
  /** The gross booking total, before any stored value is applied. */
  readonly totalAmount: string;
  /** Stored value already held against this booking, in minor units. */
  readonly walletMinor: bigint;
  /** What still needs paying: `totalAmount - walletMinor`, in minor units. */
  readonly dueMinor: bigint;
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
