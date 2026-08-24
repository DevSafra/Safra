import { z } from 'zod';

import { ERROR } from './error-codes.js';

/**
 * Enforcement against a partner: suspension, violations, and forgiving a fine.
 *
 * Bashar's policy decisions of 2026-08-24, and the principle he set above all three:
 *
 * > *"Never solve enforcement actions by deleting history. The system must always be able to answer
 * > what happened, who did it, when, why, and what financial impact occurred."*
 *
 * Every schema here carries a REQUIRED reason for that sentence alone. A suspension with no reason
 * cannot be explained to the partner it lands on; a waiver with no reason cannot be defended to the
 * next auditor. Both are decisions a person makes about somebody else's business, and the record of
 * a decision that omits why is a record of an event.
 */

/**
 * The reason a partner is TOLD, so it has a floor rather than only a ceiling.
 *
 * Twenty characters is not a quality bar and cannot be. It is a bar against «مخالفة» and «test» —
 * the one-word entry somebody types to get past a required field, which reaches a real business
 * owner as the entire explanation for why they cannot trade.
 */
/**
 * The floor, EXPORTED so the forms and the API cannot disagree about it.
 *
 * project-e9 put `minLength={20}` on the console's forms — right, because a partner-facing reason
 * rejected after the operator has typed it is a round trip for a mistake they could have been shown
 * coming. But a literal in a form and a literal in a schema are two places that know one number,
 * and the number is the kind that gets tuned. One constant, imported by both.
 */
export const ENFORCEMENT_REASON_MIN = 20;

const publicReason = z
  .string()
  .trim()
  .min(ENFORCEMENT_REASON_MIN, ERROR.VALIDATION_REQUIRED)
  .max(1000);

/** Internal notes: staff-facing, optional, never shown to the partner. */
const staffNotes = z.string().trim().max(2000).optional();

/**
 * Suspending a partner (Bashar, 2026-08-24).
 *
 * What suspension DOES is not in this schema and belongs with the enforcement, but it decides what
 * the reason has to carry, so it is stated here once:
 *
 * - listings leave search and discovery, and no new booking may be created;
 * - **existing confirmed bookings continue and existing guests are not disrupted**;
 * - payouts freeze while it is active;
 * - the partner may still SIGN IN, read their account, and read this reason;
 * - no new properties, and no publishing, modifying or activating existing ones.
 *
 * The third and fourth are the ones that shape the copy. A suspended partner's first fear is that
 * their guests have been cancelled on, and the reason they read is the only place that fear gets
 * answered.
 */
export const partnerSuspendSchema = z
  .object({ reason: publicReason, notes: staffNotes })
  .strict();
export type PartnerSuspendInput = z.infer<typeof partnerSuspendSchema>;

/**
 * Lifting a suspension, and it takes a reason too.
 *
 * Not symmetry for its own sake: lifting an enforcement action is a decision with consequences —
 * the listings return to search and the money starts moving again — and "who decided this was over,
 * and why" is a question asked exactly as often as why it began.
 */
export const partnerUnsuspendSchema = z
  .object({ reason: publicReason, notes: staffNotes })
  .strict();
export type PartnerUnsuspendInput = z.infer<typeof partnerUnsuspendSchema>;

/**
 * How far a violation has been taken. Forward only — see the `violation_stage` enum.
 */
export const VIOLATION_STAGES = ['recorded', 'warned', 'fined', 'suspension'] as const;
export type ViolationStage = (typeof VIOLATION_STAGES)[number];

/**
 * The offences a violation can record.
 *
 * Mirrors the `violation_kind` enum, and the list is Bashar's: repeated cancellations, misleading
 * information, fraudulent or misleading property content, fake images, verified guest complaints,
 * and breaches of platform rules.
 */
export const VIOLATION_KINDS = [
  'no_response',
  'rejected_after_payment',
  'stale_calendar',
  'inaccurate_listing',
  'no_show',
] as const;
export type ViolationKind = (typeof VIOLATION_KINDS)[number];

/** Raising a violation by hand — the SLA sweep writes its own without passing through here. */
export const violationRaiseSchema = z
  .object({
    kind: z.enum(VIOLATION_KINDS),
    reason: publicReason,
    notes: staffNotes,
    /** The booking it concerns, where there is one. Stale-calendar violations have none. */
    bookingReference: z.string().trim().max(64).optional(),
  })
  .strict();
export type ViolationRaiseInput = z.infer<typeof violationRaiseSchema>;

/**
 * Warning the partner — the second step of the progression, and the first they hear about.
 *
 * `recorded` means it happened. `warned` means somebody TOLD them, which is a different fact and
 * the one an appeal turns on. Nothing infers a warning from a fine for that reason.
 */
export const violationWarnSchema = z.object({ note: publicReason }).strict();
export type ViolationWarnInput = z.infer<typeof violationWarnSchema>;

/** Attaching a fine. Optional in the progression, so it is its own step rather than a field. */
export const violationFineSchema = z
  .object({
    amount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, ERROR.VALIDATION_REQUIRED),
    currencyCode: z.string().trim().length(3),
    reason: publicReason,
    /**
     * How much of the fine is credited to the CUSTOMER rather than retained (§6.4).
     *
     * Separate from the fine because they are two movements with two destinations, and a screen
     * showing only the total cannot answer "how much did the guest actually get".
     */
    customerCompensation: z
      .string()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, ERROR.VALIDATION_REQUIRED)
      .optional(),
  })
  .strict();
export type ViolationFineInput = z.infer<typeof violationFineSchema>;

/**
 * Waiving a fine (Bashar, 2026-08-24).
 *
 * > *"A waived fine must never delete or rewrite history. The original fine entry must remain
 * > permanently visible. Fine −50, Waiver +50. The net effect becomes zero, but history remains
 * > complete."*
 *
 * So this takes no amount. The waiver is always the whole fine, balanced exactly — a partial figure
 * supplied by the caller is a second number that can disagree with the first, and reconciling two
 * ledger entries that were meant to cancel is the failure this shape exists to make impossible.
 *
 * The partner is notified, so the reason is one they will read.
 */
export const fineWaiveSchema = z.object({ reason: publicReason }).strict();
export type FineWaiveInput = z.infer<typeof fineWaiveSchema>;
