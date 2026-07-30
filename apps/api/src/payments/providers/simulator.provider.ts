import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import type {
  CreateIntentInput,
  IntentOutcome,
  NormalisedEvent,
  PaymentProvider,
  RefundInput,
  RefundOutcome,
} from '../payment-provider.port.js';

/**
 * How long a signed webhook stays acceptable. Five minutes matches the industry
 * norm and is the whole anti-replay control: without it, a payload captured once
 * can be resent forever and every replay re-posts the ledger.
 */
const SIGNATURE_TOLERANCE_SECONDS = 300;

const SIGNATURE_HEADER = 'x-safra-signature';

/**
 * A gateway that behaves like a real PSD2 card acquirer, for development and CI.
 *
 * The *provider* is fictitious; the *protocol hardening is not*. Signature
 * verification, the replay window, multi-secret rotation and the challenge→webhook
 * lifecycle are all implemented exactly as a production adapter must implement
 * them, because those are the parts that carry security risk and they are worth
 * having under test long before a PSP is signed (ADR 0002 — which PSP will
 * underwrite Syria-originating business is still an open commercial question).
 *
 * Every payment starts with a Strong Customer Authentication challenge, so the
 * awkward path — customer leaves for their bank, comes back, capture arrives
 * out-of-band — is the DEFAULT path in development rather than an edge case nobody
 * exercises until launch.
 *
 * Registered only when `PAYMENT_SIMULATOR_ENABLED` is true, which the env schema
 * refuses to allow in production.
 */
@Injectable()
export class SimulatorProvider implements PaymentProvider {
  private readonly logger = new Logger(SimulatorProvider.name);

  readonly slug = 'simulator';

  /**
   * All four customer-facing rails.
   *
   * Not over-reach: every one of them is a redirect-then-webhook flow in reality — a
   * 3-D Secure challenge for the card schemes, a hosted approval for Klarna, an app
   * handoff for Sham Cash — so one simulator faithfully stands in for any of them.
   * Covering all four is what makes the whole site exercisable before a single
   * commercial agreement exists.
   */
  readonly supportedMethods = ['visa', 'mastercard', 'klarna', 'sham_cash'] as const;

  readonly isOffline = false;

  /**
   * Secrets, newest first. Accepting several at once is what makes rotating a
   * webhook secret a non-event: publish the new one, keep the old one valid until
   * the provider has switched, then drop it. A single-secret implementation forces
   * a window where live webhooks are rejected.
   */
  private readonly secrets: readonly string[];
  private readonly appUrl: string;

  constructor(secrets: readonly string[], appUrl: string) {
    this.secrets = secrets.filter((s) => s.length > 0);
    this.appUrl = appUrl;
  }

  createIntent(input: CreateIntentInput): Promise<IntentOutcome> {
    /**
     * Derived from SAFRA's payment id, not random. That makes the provider
     * reference idempotent: a retried createIntent for the same payment yields the
     * same reference instead of orphaning the first attempt.
     */
    const providerRef = `sim_${input.paymentId}`;

    const redirect = new URL('/payments/simulator/challenge', this.appUrl);
    redirect.searchParams.set('ref', providerRef);
    redirect.searchParams.set('amount', input.amount.value);
    redirect.searchParams.set('currency', input.amount.currencyCode);
    redirect.searchParams.set('return_to', input.returnUrl);

    return Promise.resolve({
      kind: 'requires_action',
      providerRef,
      redirectUrl: redirect.toString(),
    });
  }

  /**
   * Verifies `t=<unix>,v1=<hex>` over `"<t>.<rawBody>"`.
   *
   * The signature must be computed over the RAW bytes, never over a re-serialised
   * object: `JSON.parse` then `JSON.stringify` reorders keys and changes whitespace,
   * so the digest stops matching and the usual "fix" is to disable verification.
   *
   * Returns null rather than throwing on any failure, so the caller records the
   * attempt. A rejected webhook is the only evidence that the endpoint is being
   * probed, and discarding it silently destroys that evidence.
   */
  parseWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): NormalisedEvent | null {
    const header = headers[SIGNATURE_HEADER] ?? headers[SIGNATURE_HEADER.toUpperCase()];

    if (!header) {
      this.logger.warn('Webhook rejected: no signature header.');
      return null;
    }

    const parts = new Map<string, string[]>();
    for (const segment of header.split(',')) {
      const [key, value] = segment.split('=', 2);
      if (!key || value === undefined) continue;
      const existing = parts.get(key.trim());
      if (existing) existing.push(value.trim());
      else parts.set(key.trim(), [value.trim()]);
    }

    const timestamp = parts.get('t')?.[0];
    const provided = parts.get('v1') ?? [];

    if (!timestamp || provided.length === 0) {
      this.logger.warn('Webhook rejected: malformed signature header.');
      return null;
    }

    const sentAt = Number(timestamp);
    if (!Number.isFinite(sentAt)) {
      this.logger.warn('Webhook rejected: non-numeric timestamp.');
      return null;
    }

    /**
     * Absolute skew, so a FUTURE-dated timestamp is rejected too. Checking only
     * `now - sentAt` would let an attacker set a timestamp years ahead and hold a
     * replayable payload indefinitely.
     */
    const skew = Math.abs(Math.floor(Date.now() / 1000) - sentAt);
    if (skew > SIGNATURE_TOLERANCE_SECONDS) {
      this.logger.warn(`Webhook rejected: timestamp skew ${skew}s outside tolerance.`);
      return null;
    }

    const signedPayload = `${timestamp}.${rawBody}`;
    const matches = this.secrets.some((secret) => {
      const expected = createHmac('sha256', secret).update(signedPayload).digest();
      return provided.some((candidate) => equalsConstantTime(expected, candidate));
    });

    if (!matches) {
      this.logger.warn('Webhook rejected: signature did not verify.');
      return null;
    }

    return normalise(rawBody, this.logger);
  }

  /**
   * Immediate `completed`, because a card refund through a real acquirer is
   * authorised synchronously even though settlement lags. The refund row's own
   * status is what tracks money actually leaving.
   */
  refund(input: RefundInput): Promise<RefundOutcome> {
    return Promise.resolve({
      kind: 'completed',
      providerRef: `sim_refund_${input.refundId}`,
    });
  }
}

/**
 * Compares a computed digest against a hex string from the request.
 *
 * `timingSafeEqual` throws on a length mismatch, and it needs equal-length buffers
 * to be meaningful at all — so the length is checked first, then the comparison is
 * constant-time over the bytes. A plain `===` on the hex would leak, byte by byte,
 * how much of a forged signature was correct.
 */
function equalsConstantTime(expected: Buffer, candidateHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(candidateHex)) return false;

  const candidate = Buffer.from(candidateHex, 'hex');
  if (candidate.length !== expected.length) return false;

  return timingSafeEqual(expected, candidate);
}

/** Event shapes this simulator emits, mirroring a typical acquirer's vocabulary. */
const OUTCOME_BY_EVENT: Record<string, NormalisedEvent['outcome']> = {
  'payment.captured': 'captured',
  'payment.authorized': 'authorized',
  'payment.failed': 'failed',
  'payment.expired': 'expired',
  'refund.completed': 'refunded',
};

function normalise(rawBody: string, logger: Logger): NormalisedEvent | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    logger.warn('Webhook rejected: body is not JSON despite a valid signature.');
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;

  const body = parsed as Record<string, unknown>;
  const id = body['id'];
  const type = body['type'];
  const ref = body['payment_ref'];

  // A verified signature proves the sender, not the shape. Both still need checking.
  if (typeof id !== 'string' || typeof type !== 'string' || typeof ref !== 'string') {
    logger.warn('Webhook rejected: verified payload missing id, type or payment_ref.');
    return null;
  }

  const outcome = OUTCOME_BY_EVENT[type] ?? 'ignored';
  const amount = body['amount'];
  const currency = body['currency'];
  const fee = body['fee'];
  const reason = body['reason'];

  return {
    providerEventId: id,
    eventType: type,
    providerRef: ref,
    outcome,
    ...(typeof amount === 'string' && typeof currency === 'string'
      ? { amount: { value: amount, currencyCode: currency } }
      : {}),
    ...(typeof fee === 'string' ? { feeAmount: fee } : {}),
    ...(typeof reason === 'string' ? { reason } : {}),
  };
}

/**
 * Builds a correctly signed header, for tests and the local challenge page.
 *
 * Exported from the provider so there is exactly ONE implementation of the signing
 * scheme. A test helper that signs independently would happily keep passing after
 * the verifier broke.
 */
export function signSimulatorPayload(
  rawBody: string,
  secret: string,
  atUnixSeconds: number,
): string {
  const signature = createHmac('sha256', secret)
    .update(`${atUnixSeconds}.${rawBody}`)
    .digest('hex');

  return `t=${atUnixSeconds},v1=${signature}`;
}
