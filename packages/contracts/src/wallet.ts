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
     * customer's balance. THREE decimals because that is what a money column holds
     * and what JOD needs; this said two, so a three-decimal currency could not be
     * adjusted at all — the boundary refused what the platform supports.
     *
     * Three is the structural ceiling, not the answer. Whether THIS amount may carry
     * three depends on its currency, which a field schema cannot see, so
     * `WalletAdjustmentService` refuses an amount finer than the currency allows
     * rather than quantising it silently — an operator who typed 10.005 USD gets told,
     * instead of discovering later that SAFRA moved 10.01.
     */
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,3})?$/, ERROR.VALIDATION_DECIMAL_STRING)
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

/**
 * What the PLATFORM writes in a wallet movement's note — a code, never a sentence.
 *
 * `wallet_transactions.note` is read on المحفظة under «السبب», on a console that is Arabic-only,
 * and it held English prose written into eight services: «Partner did not respond within the
 * confirmation window.» on 9,083 rows. That is the standing rule exactly — no user-facing text
 * inside code, and the API answers with a CODE.
 *
 * The column keeps its double life, and deliberately: a code here, or a PERSON's own sentence when
 * a staff member typed one into a manual adjustment. Same shape as `cancellation_reason`, resolved
 * the same way — the console translates what it recognises and prints the rest as written.
 *
 * The booking reference is NOT interpolated. It was, in four of these, and it is already its own
 * column on every screen that shows a movement.
 */
export const WALLET_NOTE = {
  /** Stored value spent on a booking. */
  APPLIED_TO_BOOKING: 'wallet.note.applied_to_booking',
  /** Returned because a refund was issued against the booking. */
  REFUNDED: 'wallet.note.refunded',
  /** The hold released because the booking was cancelled before payment. */
  RETURNED_CANCELLED: 'wallet.note.returned_cancelled',
  /** The hold released because checkout was abandoned (EC-001). */
  RETURNED_EXPIRED: 'wallet.note.returned_expired',
  /** §6.4 — the partner never answered inside the confirmation window. */
  PARTNER_NO_RESPONSE: 'wallet.note.partner_no_response',
  /** A dispute resolved in the customer's favour. */
  DISPUTE_RESOLVED: 'wallet.note.dispute_resolved',
  /** Balance moved OFF a guest profile that a real account claimed. */
  CLAIMED_FROM_GUEST: 'wallet.note.claimed_from_guest',
  /** Balance moved ONTO the account that claimed the guest profile. */
  CARRIED_TO_ACCOUNT: 'wallet.note.carried_to_account',
} as const;

export type WalletNote = (typeof WALLET_NOTE)[keyof typeof WALLET_NOTE];
