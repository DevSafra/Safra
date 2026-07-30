import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SimulatorProvider, signSimulatorPayload } from './simulator.provider.js';

const SECRET = 'a'.repeat(48);
const OLD_SECRET = 'b'.repeat(48);
const APP_URL = 'https://safra.test';

function provider(secrets: string[] = [SECRET]): SimulatorProvider {
  return new SimulatorProvider(secrets, APP_URL);
}

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'evt_1',
    type: 'payment.captured',
    payment_ref: 'sim_pay_1',
    amount: '221.99',
    currency: 'USD',
    ...overrides,
  });
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function headersFor(raw: string, secret = SECRET, at = now()) {
  return { 'x-safra-signature': signSimulatorPayload(raw, secret, at) };
}

describe('SimulatorProvider.createIntent', () => {
  it('always requires an SCA challenge, so the awkward path is the default one', async () => {
    const outcome = await provider().createIntent({
      paymentId: 'pay_1',
      bookingReference: 'BKG-2026-000001',
      amount: { value: '221.99', currencyCode: 'USD' },
      returnUrl: 'https://safra.test/payments/return',
      customerEmail: 'guest@example.test',
      locale: 'ar',
    });

    expect(outcome.kind).toBe('requires_action');
  });

  it('derives the provider reference from the payment id so a retry is idempotent', async () => {
    const input = {
      paymentId: 'pay_stable',
      bookingReference: 'BKG-2026-000001',
      amount: { value: '10.00', currencyCode: 'USD' },
      returnUrl: 'https://safra.test/payments/return',
      customerEmail: 'guest@example.test',
      locale: 'ar',
    };

    const first = await provider().createIntent(input);
    const second = await provider().createIntent(input);

    expect(first).toStrictEqual(second);
  });
});

describe('SimulatorProvider.parseWebhook signature verification', () => {
  it('accepts a correctly signed payload', () => {
    const raw = body();
    const event = provider().parseWebhook(raw, headersFor(raw));

    expect(event).not.toBeNull();
    expect(event?.outcome).toBe('captured');
    expect(event?.providerEventId).toBe('evt_1');
    expect(event?.amount).toStrictEqual({ value: '221.99', currencyCode: 'USD' });
  });

  it('rejects a payload with no signature header', () => {
    expect(provider().parseWebhook(body(), {})).toBeNull();
  });

  it('rejects a signature computed with the wrong secret', () => {
    const raw = body();
    const forged = headersFor(raw, 'c'.repeat(48));

    expect(provider().parseWebhook(raw, forged)).toBeNull();
  });

  /**
   * The regression that matters most: if the body is re-serialised anywhere between
   * the provider signing it and this verifying it, the digest stops matching. A
   * single added space must break verification — that is what proves the comparison
   * is over raw bytes rather than a parsed object.
   */
  it('rejects a body modified after signing, even by one character', () => {
    const raw = body();
    const headers = headersFor(raw);

    expect(provider().parseWebhook(`${raw} `, headers)).toBeNull();
  });

  it('rejects a replay outside the tolerance window', () => {
    const raw = body();
    const stale = headersFor(raw, SECRET, now() - 3600);

    expect(provider().parseWebhook(raw, stale)).toBeNull();
  });

  /**
   * Future-dated timestamps must fail too. Checking only `now - t` would let an
   * attacker mint a payload dated years ahead and replay it indefinitely.
   */
  it('rejects a future-dated timestamp', () => {
    const raw = body();
    const future = headersFor(raw, SECRET, now() + 3600);

    expect(provider().parseWebhook(raw, future)).toBeNull();
  });

  it('accepts an older secret during rotation, and the new one', () => {
    const raw = body();
    const rotating = provider([SECRET, OLD_SECRET]);

    expect(rotating.parseWebhook(raw, headersFor(raw, SECRET))).not.toBeNull();
    expect(rotating.parseWebhook(raw, headersFor(raw, OLD_SECRET))).not.toBeNull();
  });

  it('rejects everything when no secret is configured', () => {
    const raw = body();
    // An empty secret list must fail closed rather than skip verification.
    expect(provider([]).parseWebhook(raw, headersFor(raw))).toBeNull();
  });

  it('rejects a non-hex signature without throwing', () => {
    const raw = body();
    const headers = { 'x-safra-signature': `t=${now()},v1=not-hex-at-all` };

    expect(() => provider().parseWebhook(raw, headers)).not.toThrow();
    expect(provider().parseWebhook(raw, headers)).toBeNull();
  });

  it('rejects a truncated signature of the wrong length', () => {
    const raw = body();
    const full = createHmac('sha256', SECRET).update(`${now()}.${raw}`).digest('hex');
    const headers = { 'x-safra-signature': `t=${now()},v1=${full.slice(0, 32)}` };

    expect(provider().parseWebhook(raw, headers)).toBeNull();
  });

  it('rejects a malformed header with no timestamp', () => {
    const raw = body();
    expect(provider().parseWebhook(raw, { 'x-safra-signature': 'v1=abc' })).toBeNull();
  });
});

describe('SimulatorProvider.parseWebhook payload validation', () => {
  /**
   * A verified signature proves who sent the body, not that the body is well
   * formed. Both have to be checked, or a signed-but-malformed payload reaches the
   * dispatcher.
   */
  it('rejects a signed payload missing payment_ref', () => {
    const raw = JSON.stringify({ id: 'evt_2', type: 'payment.captured' });

    expect(provider().parseWebhook(raw, headersFor(raw))).toBeNull();
  });

  it('rejects a signed body that is not JSON', () => {
    const raw = 'not json at all';

    expect(provider().parseWebhook(raw, headersFor(raw))).toBeNull();
  });

  it('maps an unknown event type to "ignored" rather than guessing', () => {
    const raw = body({ type: 'payment.something_new' });
    const event = provider().parseWebhook(raw, headersFor(raw));

    expect(event?.outcome).toBe('ignored');
  });

  it.each([
    ['payment.captured', 'captured'],
    ['payment.authorized', 'authorized'],
    ['payment.failed', 'failed'],
    ['payment.expired', 'expired'],
    ['refund.completed', 'refunded'],
  ])('maps %s to %s', (type, expected) => {
    const raw = body({ type });
    expect(provider().parseWebhook(raw, headersFor(raw))?.outcome).toBe(expected);
  });
});
