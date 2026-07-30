import { z } from 'zod';

/**
 * Every payment rail the system knows. Mirrors the `payment_method` database enum.
 *
 * Includes rails a customer never picks — `gift_card` and `wallet` are internal
 * SAFRA balances (§7.3, §11.2) and `bank_transfer` is a finance-side fallback — so
 * validating a stored value against this list is correct, but rendering it to a
 * customer is not. Use CUSTOMER_FACING_METHODS for that.
 */
export const PAYMENT_METHODS = [
  'visa',
  'mastercard',
  'sham_cash',
  'klarna',
  'gift_card',
  'wallet',
  'bank_transfer',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * The four methods the site may offer, in display order (Bashar, 2026-07-30).
 *
 * This is a WHITELIST and the outer bound on what checkout can show: a method
 * absent here can never be offered even if a provider supports it. PayPal and
 * Apple Pay were removed on instruction; Stripe never appears because it is a
 * gateway rather than a method, and is excluded as a gateway (ADR 0002).
 *
 * Appearing here does NOT mean a method works — `visa` and `mastercard` are card
 * schemes needing an acquirer, and `klarna` needs a merchant agreement. The
 * intersection of this list with what routing can actually serve is what checkout
 * renders, so an unavailable method is hidden rather than shown and broken.
 */
export const CUSTOMER_FACING_METHODS = [
  'visa',
  'mastercard',
  'klarna',
  'sham_cash',
] as const satisfies readonly PaymentMethod[];

export type CustomerFacingMethod = (typeof CUSTOMER_FACING_METHODS)[number];

export function isCustomerFacingMethod(value: string): value is CustomerFacingMethod {
  return (CUSTOMER_FACING_METHODS as readonly string[]).includes(value);
}

/**
 * Booking access token: 32 random bytes, base64url.
 *
 * Length and alphabet are both pinned. Without the charset bound, an oversized or
 * exotic string reaches the constant-time comparison and the hashing path for no
 * reason — cheap to reject at the boundary, per rule 1.
 */
const accessTokenSchema = z
  .string()
  .min(43)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Malformed access token.');

/**
 * Starting a payment.
 *
 * Note what is ABSENT: any amount, currency, or fee. The total is read from the
 * booking server-side. Accepting a client-supplied price is the oldest e-commerce
 * vulnerability there is, so the field does not exist to be trusted.
 */
export const startPaymentSchema = z
  .object({
    reference: z.string().regex(/^BKG-\d{4}-\d{6}$/, 'Malformed booking reference.'),
    accessToken: accessTokenSchema,
    /**
     * Restricted to the customer-facing four, not all of PAYMENT_METHODS. A client
     * asking to pay by `wallet`, `gift_card` or `bank_transfer` would be selecting
     * a rail that settles against an internal balance or a manual finance step —
     * neither is something a request may choose for itself.
     *
     * Still advisory within that set: routing decides what is actually available.
     */
    method: z.enum(CUSTOMER_FACING_METHODS).optional(),
  })
  .strict();

export type StartPaymentRequest = z.infer<typeof startPaymentSchema>;

/** Staff-initiated refund. The AMOUNT is computed from the policy, never supplied. */
export const createRefundSchema = z
  .object({
    reason: z.string().min(3).max(500),
  })
  .strict();

export type CreateRefundRequest = z.infer<typeof createRefundSchema>;
