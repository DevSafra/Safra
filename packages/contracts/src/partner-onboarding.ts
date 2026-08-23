import { z } from 'zod';

import { localeSchema, phoneSchema } from './auth.js';
import { ERROR } from './error-codes.js';
import { PARTNER_DOCUMENT_KINDS, type PartnerDocumentKind } from './property.js';

/**
 * Onboarding a partner IN PERSON — the super admin and the partner, sitting together
 * (Bashar, 2026-08-23).
 *
 * ## Why this exists next to «انضم كشريك» rather than inside it
 *
 * The public flow is seven steps spread over days: a form, a telephone call, an acceptance, an
 * invitation, an upload, a review, an approval. It is built for a stranger who filled in a form,
 * and every one of its safeguards assumes the two parties are apart and communicating through a
 * mailbox.
 *
 * Sitting at the same table, most of those steps are already done — the conversation happened, the
 * documents are on the table, the contract is about to be signed on paper by both people present.
 * Forcing that meeting through a queue built for absence means the partner leaves with nothing and
 * the platform waits for an email round trip to record what everybody in the room already agreed.
 *
 * So this is a SEPARATE action with a separate name, not a flag on the application flow. The
 * reason is the audit log: `partner_application.accepted` means "a request somebody filed was
 * granted", and an action that lets a super admin NAME an address and make it a partner is a
 * materially different power. Wearing the same label, it would be invisible.
 *
 * ## What it deliberately cannot do
 *
 * **It cannot set anybody's password, and it cannot sign anybody in.** The account it creates or
 * adopts has no password hash, exactly as `staff.invited` leaves one, and the partner establishes
 * their own from a link mailed to their own inbox. That is what keeps "make an account of my
 * choosing a partner" honest: the `partners` row is written immediately, but `users.role` stays
 * `customer` until somebody proves they hold the mailbox by redeeming the invitation — and
 * `partnerId` only enters a token for a user whose role is already `partner`
 * (`token.service.ts`). Creating the row therefore grants the named account nothing at all.
 *
 * Two accounts are refused outright rather than adopted, the same two «انضم كشريك» refuses: a
 * STAFF account, because an onboarding that quietly demotes an operations manager is an escalation
 * path wearing an innocent label, and one that is already a partner, because there is nothing to
 * create.
 *
 * ## No `verification`, no `score`, no `tier`, no `status`
 *
 * The form describes a BUSINESS. Everything about SAFRA's opinion of that business is set by the
 * approval step, from its own screen, with its own permission — so there is no field here that
 * could arrive from a request and land the partner approved without a reviewer.
 */
export const partnerOnboardSchema = z
  .object({
    /** The person in the room. Recorded because a legal entity does not answer a telephone. */
    contactName: z
      .string()
      .trim()
      .min(2, ERROR.VALIDATION_REQUIRED)
      .max(120, ERROR.VALIDATION_TOO_LONG),

    /**
     * The partner's address — and the one field here that names somebody else's account.
     *
     * Lower-cased on the way in so `Ali@x.test` and `ali@x.test` cannot become two partners; the
     * `users_email_unique` index is over the raw column, and matching its shape here is what keeps
     * the check and the constraint agreeing.
     */
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email(ERROR.VALIDATION_EMAIL_INVALID)
      .max(320, ERROR.VALIDATION_TOO_LONG),
    phone: phoneSchema,

    legalName: z
      .string()
      .trim()
      .min(2, ERROR.VALIDATION_REQUIRED)
      .max(200, ERROR.VALIDATION_TOO_LONG),
    displayName: z
      .string()
      .trim()
      .min(2, ERROR.VALIDATION_REQUIRED)
      .max(120, ERROR.VALIDATION_TOO_LONG),

    /** A CODE, resolved server-side against `partner_types`. A caller who could send an id … */
    partnerTypeCode: z
      .string()
      .trim()
      .min(2, ERROR.VALIDATION_REQUIRED)
      .max(40, ERROR.VALIDATION_TOO_LONG),
    citySlug: z
      .string()
      .trim()
      .min(2, ERROR.VALIDATION_REQUIRED)
      .max(80, ERROR.VALIDATION_TOO_LONG),
    address: z
      .string()
      .trim()
      .min(4, ERROR.VALIDATION_REQUIRED)
      .max(300, ERROR.VALIDATION_TOO_LONG),

    website: z
      .string()
      .trim()
      .url(ERROR.VALIDATION_URL_INVALID)
      .max(300, ERROR.VALIDATION_TOO_LONG)
      .optional(),

    /**
     * Why this partner was onboarded in person, in the operator's own words.
     *
     * REQUIRED, and it is the only field here that exists purely for the record. This action
     * bypasses the queue that normally produces a paper trail — the request, the call log, the
     * decision note — so without it the audit log would show a partner appearing out of nothing
     * with no account of who was in the room. Two characters is not a bar to clear; being unable
     * to do it silently is the point.
     */
    notes: z
      .string()
      .trim()
      .min(2, ERROR.VALIDATION_REQUIRED)
      .max(2000, ERROR.VALIDATION_TOO_LONG),

    /** Which language SAFRA writes to them in — the invitation, and everything after it. */
    preferredLocale: localeSchema.default('ar'),
  })
  .strict();

export type PartnerOnboardInput = z.infer<typeof partnerOnboardSchema>;

/** What the console gets back: where to go next, and whether the mail got out. */
export interface PartnerOnboardResult {
  readonly reference: string;
  /**
   * Whether the account already existed and was adopted rather than created.
   *
   * Surfaced because it changes what the operator should SAY to the person sitting opposite them
   * — "check your inbox for a link" versus "you already have a SAFRA account; the link upgrades
   * it" — and because it is the one branch of this action they cannot see from the result screen.
   */
  readonly accountExisted: boolean;
}

/**
 * The documents §8.1 wants on file before a partner is approved.
 *
 * A CHECKLIST, not a gate. `verifyPartner` does not consult it and deliberately so: the sanctions
 * feed already taught this codebase what happens when onboarding is made to depend on a control
 * that can be unavailable (see `review.service.ts`), and a partner who is standing in the room
 * with a passport but whose commercial register is with their accountant is a conversation, not a
 * refusal. The screen shows what is outstanding; the reviewer decides.
 */
export const PARTNER_ONBOARDING_REQUIRED_DOCUMENTS = [
  'identity',
  'commercial_register',
] as const satisfies readonly PartnerDocumentKind[];

/**
 * Proof of the right to let, which comes in one of two shapes.
 *
 * An owner has a title deed; a manager has a management contract. Requiring both would refuse
 * every partner who is only one of the two, and requiring neither would let a partner be approved
 * with no evidence they may let the property at all.
 */
export const PARTNER_ONBOARDING_RIGHT_TO_LET_DOCUMENTS = [
  'ownership_proof',
  'management_contract',
] as const satisfies readonly PartnerDocumentKind[];

/**
 * Which required documents are still missing, given what has been uploaded.
 *
 * Takes the kinds rather than the rows so the console and any future gate answer from the same
 * function instead of two hand-written comparisons that drift. Returns `right_to_let` as a single
 * pseudo-kind when neither of its two alternatives is present — the reader needs to know one of
 * them is wanted, not that both are.
 */
export function missingOnboardingDocuments(
  uploaded: readonly string[],
): readonly (PartnerDocumentKind | 'right_to_let')[] {
  const present = new Set(uploaded);

  const missing: (PartnerDocumentKind | 'right_to_let')[] =
    PARTNER_ONBOARDING_REQUIRED_DOCUMENTS.filter((kind) => !present.has(kind));

  if (!PARTNER_ONBOARDING_RIGHT_TO_LET_DOCUMENTS.some((kind) => present.has(kind))) {
    missing.push('right_to_let');
  }

  return missing;
}

/** Every kind the console's upload control offers, in the order §8.1 asks for them. */
export const PARTNER_ONBOARDING_DOCUMENT_ORDER = PARTNER_DOCUMENT_KINDS;
