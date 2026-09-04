import { z } from 'zod';
import { ERROR } from './error-codes.js';

/**
 * Every rail SAFRA can settle a partner ON. Mirrors nothing in the payment enum, deliberately.
 *
 * `PAYMENT_METHODS` is how money comes IN from a guest, and the two lists only look alike. A card
 * scheme is not a way to pay a partner, and a cash office is not a way for a guest to pay SAFRA —
 * sharing one list would let a payout account be created against `visa` and a checkout offer
 * `cash_office`, and both would validate.
 */
export const PAYOUT_METHODS = ['bank_transfer', 'sham_cash', 'cash_office'] as const;

export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

/** `pending` → `verified` or `rejected`; any material edit returns it to `pending`. */
export const PAYOUT_ACCOUNT_STATUSES = ['pending', 'verified', 'rejected'] as const;

export type PayoutAccountStatus = (typeof PAYOUT_ACCOUNT_STATUSES)[number];

/**
 * The characters an account number may contain, and nothing else.
 *
 * IBANs, Syrian domestic account numbers and Sham Cash wallet numbers are all alphanumeric; the
 * spaces people type into an IBAN are stripped before this runs. The restriction is not cosmetic:
 * this value is encrypted, stored, and later read back by a human who will retype it into a
 * banking system, so anything that could carry a formula, a control character or a homoglyph is
 * refused at the boundary rather than sanitised on the way out.
 */
const ACCOUNT_NUMBER = /^[A-Za-z0-9]{4,34}$/;

/** ISO 9362 — 8 or 11 characters, upper case. Optional, because domestic transfers have none. */
const SWIFT = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

const accountNumber = z
  .string()
  .trim()
  /* An IBAN is written in groups of four and read back with the spaces; neither is the value. */
  .transform((value) => value.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(ACCOUNT_NUMBER, ERROR.VALIDATION_ACCOUNT_NUMBER));

const holder = z
  .string()
  .trim()
  .min(2, ERROR.VALIDATION_REQUIRED)
  .max(120, ERROR.VALIDATION_TOO_LONG);

/**
 * A payout account, as somebody types it — partner or staff, one schema for both.
 *
 * Two entry paths were Bashar's decision on 2026-09-04: «The partner can enter and maintain their
 * own payout-account details through the Partner Portal. Authorised staff can also enter or update
 * payout-account details on behalf of the partner through the Admin Console when required.» They
 * validate identically on purpose — a rule that is stricter on one door is a rule an attacker
 * reads as an instruction about which door to use.
 *
 * The partner id is NOT here. On the partner route it comes from the token, and on the staff route
 * from the path — never from a body, which is the difference between authorising a write and
 * accepting one.
 */
export const payoutAccountInputSchema = z
  .object({
    method: z.enum(PAYOUT_METHODS, { message: ERROR.VALIDATION_PAYOUT_METHOD }),
    accountHolder: holder,
    accountNumber,
    bankName: z.string().trim().max(120, ERROR.VALIDATION_TOO_LONG).optional(),
    swiftCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(SWIFT, ERROR.VALIDATION_SWIFT)
      .optional()
      .or(z.literal('')),
    /** The currency SAFRA transfers IN, so the partner's bank does not convert twice. */
    currency: z.string().trim().toUpperCase().length(3, ERROR.VALIDATION_CURRENCY_CODE),
  })
  .strict();

export type PayoutAccountInput = z.infer<typeof payoutAccountInputSchema>;

/**
 * Why an account was refused — required, and shown to the partner.
 *
 * A rejection with no reason is a dead end: the partner can see that their details were refused
 * and has no way to work out which field to correct, so they resubmit the same thing. The minimum
 * is deliberately long enough to stop «لا» being a valid answer.
 */
export const payoutAccountRejectSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(8, ERROR.VALIDATION_REQUIRED)
      .max(500, ERROR.VALIDATION_TOO_LONG),
  })
  .strict();

export type PayoutAccountReject = z.infer<typeof payoutAccountRejectSchema>;

/**
 * The last four digits, and never more, for a value that may be shorter than four.
 *
 * A wallet number of three characters would make `slice(-4)` return the WHOLE number, so masking
 * would leak exactly the value it exists to hide. The mask is built from the length rather than
 * from a fixed number of dots for the same reason.
 */
export function last4(accountNumber: string): string {
  return accountNumber.length > 4 ? accountNumber.slice(-4) : '';
}

/**
 * A material change is one that changes WHERE THE MONEY GOES.
 *
 * Bashar's rule on 2026-09-04 is «every material change must require verification», and this
 * function is the whole of what "material" means. Everything the schema accepts is in it, which is
 * the honest answer: there is no cosmetic field on a payout account. A nickname would be one; the
 * table has none, and if one is ever added it belongs on the other side of this comparison rather
 * than quietly inheriting re-verification.
 *
 * It compares the STORED form — trimmed, spaces stripped, upper-cased — because a partner who
 * retypes their own IBAN with different spacing has not changed anything, and sending that back
 * through verification would train staff to approve without reading.
 */
export function isMaterialChange(
  before: {
    readonly method: string;
    readonly accountHolder: string;
    readonly accountNumber: string;
    readonly bankName: string | null;
    readonly swiftCode: string | null;
    readonly currency: string;
  },
  after: PayoutAccountInput,
): boolean {
  return (
    before.method !== after.method ||
    before.accountHolder !== after.accountHolder ||
    before.accountNumber !== after.accountNumber ||
    (before.bankName ?? '') !== (after.bankName ?? '') ||
    (before.swiftCode ?? '') !== (after.swiftCode ?? '') ||
    before.currency !== after.currency
  );
}
