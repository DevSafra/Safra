import { z } from 'zod';

import { ERROR } from './error-codes.js';
import { cursorQuerySchema } from './pagination.js';

/**
 * النزاعات — a customer raising a dispute about their own booking.
 *
 * The tables, the console queue and the payout freeze have existed since the first migration; what
 * did not exist was any way to open one. Staff created them by hand, which meant a customer's only
 * route to a dispute was a phone call somebody had to transcribe.
 *
 * ## Why the CUSTOMER only, and not the partner
 *
 * Every value of `dispute_kind` is a complaint about the stay or about the partner —
 * `property_unavailable` (EC-006), `not_as_described` (EC-007), `partner_no_response` (EC-008), and
 * `complaint` for anything else. There is no partner-side reason in the enum, and inventing one
 * would be deciding what a partner is entitled to dispute — a product question, not a gap to fill
 * while wiring up a form. Recorded in `docs/FUTURE-WORK.md` rather than guessed at.
 *
 * ## A dispute has a title and a support ticket does not
 *
 * `supportOpenSchema` deliberately refuses a subject line, on the grounds that it becomes a second
 * thing to read and translate and a place for the contact details the body is redacted for. Two of
 * those three still apply here, and the design overrules them anyway: the console's dispute card
 * shows a one-line title, and a queue that staff triage needs one. So it is asked for, in the
 * customer's own words, and redacted exactly like the description — the third objection is the one
 * that is answered rather than dismissed.
 */

/** The four reasons the schema's enum allows, as a caller may name them. */
export const disputeKindSchema = z.enum([
  'property_unavailable',
  'not_as_described',
  'partner_no_response',
  'complaint',
]);

export type DisputeKind = z.infer<typeof disputeKindSchema>;

/**
 * Opening a dispute.
 *
 * The booking is named by REFERENCE, not by id. A reference is what a customer has in front of them
 * — on the voucher, in the email, on the booking page — and the service resolves it against their own
 * bookings, so naming somebody else's is a 404 rather than an authorization error to be probed.
 */
export const disputeOpenSchema = z
  .object({
    /** `BKG-2026-000042`. Shape-checked here; ownership is checked in the service. */
    bookingReference: z.string().trim().min(6).max(40),
    kind: disputeKindSchema,
    /**
     * The one line the console's card shows.
     *
     * Short enough to be a line and long enough to be useful. Redacted on the way in like every
     * other prose this platform stores from a customer.
     */
    title: z.string().trim().min(4, ERROR.SUPPORT_MESSAGE_TOO_SHORT).max(120),
    /** Their own account of what happened, kept verbatim and never summarised into the title. */
    description: z
      .string()
      .trim()
      .min(20, ERROR.SUPPORT_MESSAGE_TOO_SHORT)
      .max(4000, ERROR.VALIDATION_TOO_LONG),
  })
  .strict();

export type DisputeOpenInput = z.infer<typeof disputeOpenSchema>;

/** The caller's own disputes. Cursor-based, like every other customer-facing list. */
export const disputeQuerySchema = cursorQuerySchema;

export type DisputeQuery = z.infer<typeof disputeQuerySchema>;

/**
 * What the asking side is told about a dispute.
 *
 * Deliberately NOT the whole row. `assignedToUserId`, the internal notes and the staff who closed it
 * are the console's business — a customer learning which agent holds their case invites them to ask
 * for that person by name, and it leaks the shape of the team. `resolution` IS included: it is the
 * answer they are waiting for, and withholding it would make the screen pointless.
 */
export interface DisputeSummary {
  /** `DSP-000112`. */
  readonly reference: string;
  readonly bookingReference: string;
  readonly kind: DisputeKind;
  /** `open` | `investigating` | `resolved` | `rejected`. */
  readonly status: string;
  readonly title: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  /** Stated when the dispute is closed; null while it is open. */
  readonly resolution: string | null;
  /** How many spans the redactor removed from the title and description together. */
  readonly redactedCount: number;
}

export interface DisputeDetail extends DisputeSummary {
  readonly description: string | null;
}
