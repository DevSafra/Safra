import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ERROR,
  CUSTOMER_FACING_METHODS,
  type CustomerFacingMethod,
} from '@safra/contracts';

import type { Env } from '../../config/env.js';
import { ENV } from '../../config/env.js';
import { SettingsService } from '../../settings/settings.service.js';
import type { PaymentProvider } from '../payment-provider.port.js';
import { ManualTransferProvider } from './manual-transfer.provider.js';
import { SimulatorProvider } from './simulator.provider.js';
import { unavailable } from '../../common/errors/app-error.js';

/**
 * Settings key holding the routing table (P-005 — rails are configuration).
 *
 * Shape: `{ "SY": ["manual_transfer"], "*": ["manual_transfer"] }` — an ordered
 * preference list per ISO country code, with `*` as the fallback. Ordered rather
 * than a single value so a failing primary can fall through to a working secondary
 * without an admin edit at the worst possible moment.
 */
const ROUTING_KEY = 'payment.provider_routing';

/** Used when the setting is absent, so a half-seeded database still takes money. */
const DEFAULT_ROUTING: Record<string, string[]> = { '*': ['manual_transfer'] };

interface RoutingTable {
  [countryCode: string]: string[];
}

/**
 * Resolves which gateway handles a payment (ADR 0002).
 *
 * Exists because the PSP is genuinely undecided: `Safra Technologies GmbH` cannot
 * use Stripe or PayPal for Syria-originating accommodation, so whichever acquirer
 * eventually underwrites SAFRA has to be addable without touching booking or ledger
 * code. Registration here plus a routing row in settings is the whole integration.
 *
 * Refunds do NOT route through this table — they must go back through the provider
 * that took the money, which is why `payments.provider` is persisted per payment
 * and looked up by slug instead.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly logger = new Logger(PaymentProviderRegistry.name);
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(
    @Inject(ENV) env: Env,
    private readonly settings: SettingsService,
    manualTransfer: ManualTransferProvider,
  ) {
    this.register(manualTransfer);

    /**
     * Conditional registration, not a conditional branch at call time. If the
     * simulator is not registered it cannot be selected by a routing row, a
     * request parameter, or a mistake — there is nothing to select.
     */
    if (env.PAYMENT_SIMULATOR_ENABLED) {
      this.register(
        new SimulatorProvider(env.PAYMENT_SIMULATOR_WEBHOOK_SECRETS, env.APP_URL),
      );
      this.logger.warn(
        'Payment simulator is ENABLED. Payments can be captured without money. ' +
          'This must never be a production configuration.',
      );
    }
  }

  private register(provider: PaymentProvider): void {
    this.providers.set(provider.slug, provider);
  }

  /** Every registered slug, for the admin settings screen to offer. */
  availableSlugs(): string[] {
    return [...this.providers.keys()];
  }

  /**
   * Looks up by slug for refunds and webhook dispatch.
   *
   * Returns undefined rather than throwing: a webhook naming an unregistered
   * provider is a routine consequence of disabling one, and it must be recorded
   * rather than crash the endpoint.
   */
  bySlug(slug: string): PaymentProvider | undefined {
    return this.providers.get(slug);
  }

  /**
   * The methods checkout may offer for a country, in display order.
   *
   * Two filters, and both matter. The whitelist is the outer bound — a method absent
   * from CUSTOMER_FACING_METHODS can never be offered even if a provider supports it
   * (that is what removing PayPal means in practice). Within that, a method is only
   * offered when a routed provider can actually serve it, so an unavailable rail is
   * hidden rather than shown and then failing at the worst moment.
   *
   * An empty result is a legitimate answer, not an error: with Visa, Mastercard and
   * Klarna all pending commercial agreements, no external rail is live yet.
   */
  async availableMethodsForCountry(countryCode: string): Promise<CustomerFacingMethod[]> {
    const routing = await this.settings.get<RoutingTable>(ROUTING_KEY, DEFAULT_ROUTING);

    const slugs = [
      ...(routing[countryCode.toUpperCase()] ?? []),
      ...(routing['*'] ?? []),
    ];

    const servable = new Set<string>();
    for (const slug of slugs) {
      for (const method of this.providers.get(slug)?.supportedMethods ?? []) {
        servable.add(method);
      }
    }

    // Iterating the whitelist preserves the approved display order (§7.1).
    return CUSTOMER_FACING_METHODS.filter((method) => servable.has(method));
  }

  /**
   * Picks the provider for a new payment.
   *
   * Country comes from the PROPERTY, not the customer: the constraint being routed
   * around is where the accommodation is, which is what determines whether a given
   * acquirer will touch the transaction at all.
   */
  async resolveForCountry(
    countryCode: string,
    method: string | undefined,
  ): Promise<PaymentProvider> {
    const routing = await this.settings.get<RoutingTable>(ROUTING_KEY, DEFAULT_ROUTING);

    const candidates = [
      ...(routing[countryCode.toUpperCase()] ?? []),
      ...(routing['*'] ?? []),
    ];

    for (const slug of candidates) {
      const provider = this.providers.get(slug);
      if (!provider) {
        // A configured-but-unregistered provider is an admin error worth surfacing,
        // not a reason to fail the payment while a working alternative exists.
        this.logger.error(
          `Routing for "${countryCode}" names unregistered provider "${slug}".`,
        );
        continue;
      }

      if (method && !provider.supportedMethods.includes(method)) continue;

      return provider;
    }

    /**
     * Generic to the client, specific in the log (rule 1). A customer learning
     * which gateways SAFRA has tried and failed to configure is an information
     * leak with no upside.
     */
    this.logger.error(
      `No payment provider available for country "${countryCode}"` +
        `${method ? ` and method "${method}"` : ''}. Candidates tried: ${
          candidates.join(', ') || 'none'
        }.`,
    );

    throw unavailable(ERROR.PAYMENT_UNAVAILABLE);
  }
}
