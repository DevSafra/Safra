import { z } from 'zod';
import { ERROR } from './error-codes.js';

/**
 * A manual wallet adjustment by finance (SRS §2.3, §4.1).
 *
 * §4.1 classes this as sensitive: it moves real money on nothing but a staff
 * member's judgement, so the schema is deliberately narrow. There is no
 * `customerProfileId` field — the subject comes from the route, so a body cannot
 * redirect a credit at a different customer than the one being audited.
 */
export const walletAdjustSchema = z
  .object({
    /**
     * A decimal STRING, never a number.
     *
     * A JSON number is an IEEE-754 double, and this value is added straight to a
     * customer's balance. Two decimals because every money column in the schema is
     * `numeric(14,2)` — accepting more would silently round on write.
     */
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, ERROR.VALIDATION_DECIMAL_STRING)
      .refine((v) => Number(v) > 0, ERROR.VALIDATION_AMOUNT_POSITIVE),

    /**
     * Credit hands money to the customer; debit takes it back.
     *
     * Both directions exist because the realistic use is correcting a mistake, and
     * a system that can only ever credit forces finance to fix an over-credit by
     * crediting somebody else.
     */
    direction: z.enum(['credit', 'debit']),

    /** ISO 4217. The wallet converts through SYP if it is denominated otherwise. */
    currency: z.string().regex(/^[A-Z]{3}$/, ERROR.VALIDATION_CURRENCY_CODE),

    /**
     * Mandatory, and not a free-for-all length.
     *
     * An adjustment with no stated reason is unreviewable, which defeats the audit
     * requirement that justifies allowing it at all.
     */
    note: z.string().trim().min(10, ERROR.VALIDATION_REASON_REQUIRED).max(500),
  })
  .strict();

export type WalletAdjustInput = z.infer<typeof walletAdjustSchema>;
