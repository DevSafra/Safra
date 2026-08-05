import { z } from 'zod';
import { ERROR } from './error-codes.js';

/**
 * Setting an FX rate to SYP (SRS §1.4).
 *
 * The quote currency is always SYP and is NOT a field. The table can express any
 * pair, but only `X → SYP` affects pricing, so accepting an arbitrary quote would
 * let an admin configure `USD → EUR`, see a success response, and still have a
 * platform that refuses to price. Narrowing the endpoint to what it actually
 * influences is the honest shape.
 */
export const setFxRateSchema = z
  .object({
    /** Base currency, ISO 4217. The pair is completed with SYP. */
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, ERROR.VALIDATION_CURRENCY_CODE)
      .refine((v) => v !== 'SYP', ERROR.VALIDATION_RATE_SYP_FIXED),

    /**
     * A decimal STRING, never a number.
     *
     * SYP rates are five significant digits and climbing; a JSON number arrives as
     * an IEEE-754 double, and the whole point of this fix is that SYP figures stop
     * being quietly wrong. Up to 8 decimal places, matching the column.
     */
    rate: z
      .string()
      .regex(/^\d+(\.\d{1,8})?$/, ERROR.VALIDATION_DECIMAL_STRING)
      .refine((v) => Number(v) > 0, ERROR.VALIDATION_RATE_POSITIVE),

    /**
     * When it takes effect. Future-dating is allowed so a rate change can be
     * scheduled; pricing reads the newest row whose `effectiveFrom` has passed.
     */
    effectiveFrom: z.string().datetime().optional(),

    /** Recorded for auditability — §13.3 wants to know where a figure came from. */
    source: z.enum(['manual', 'central_bank', 'provider']).default('manual'),
  })
  .strict();

export type SetFxRateRequest = z.infer<typeof setFxRateSchema>;
