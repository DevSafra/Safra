import { z } from 'zod';

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
      .regex(/^[A-Z]{3}$/, 'Must be a three-letter uppercase ISO 4217 code.')
      .refine((v) => v !== 'SYP', 'The SYP→SYP rate is always 1 and cannot be set.'),

    /**
     * A decimal STRING, never a number.
     *
     * SYP rates are five significant digits and climbing; a JSON number arrives as
     * an IEEE-754 double, and the whole point of this fix is that SYP figures stop
     * being quietly wrong. Up to 8 decimal places, matching the column.
     */
    rate: z
      .string()
      .regex(/^\d+(\.\d{1,8})?$/, 'Must be a positive decimal string, e.g. "13000.00".')
      .refine((v) => Number(v) > 0, 'Rate must be greater than zero.'),

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
