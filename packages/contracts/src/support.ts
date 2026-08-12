import { z } from 'zod';

import { ERROR } from './error-codes.js';
import { cursorQuerySchema } from './pagination.js';

/**
 * الدعم — a customer or partner asking SAFRA for help.
 *
 * Bashar, 2026-08-12: a support page on the customer and partner dashboards, with staff managing
 * everything from the console.
 *
 * ## A ticket is a CONVERSATION, not a new kind of thing
 *
 * `conversations` and `messages` already carry a three-party thread, contact-detail redaction, an
 * unread counter for staff, and internal staff-only notes. A separate `tickets` table would duplicate
 * every one of those and split "everything a person said to us" across two places — which is exactly
 * what the messaging module's own note warns against for customer and partner threads.
 *
 * What was missing was a legal SHAPE: `conversations_exactly_one_subject` demanded a booking, a dispute
 * or a partner, and a ticket is about none of those. The `_v2` constraint allows a subject-less thread
 * provided a customer is named; a partner ticket already fitted, since `partner_id` alone was legal.
 */

/**
 * The first message of a ticket.
 *
 * No subject line. A one-line summary sounds helpful and is not: it becomes a second thing to read, a
 * second thing to translate, and a place for the contact details the body is redacted for. The thread's
 * reference identifies it and its first message says what it is about.
 */
export const supportOpenSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(10, ERROR.SUPPORT_MESSAGE_TOO_SHORT)
      .max(4000, ERROR.VALIDATION_TOO_LONG),
  })
  .strict();

export type SupportOpenInput = z.infer<typeof supportOpenSchema>;

/** A further message on a ticket the caller already owns. */
export const supportReplySchema = supportOpenSchema;

export type SupportReplyInput = SupportOpenInput;

/** The ticket list. Cursor-based, like every other customer-facing list. */
export const supportQuerySchema = cursorQuerySchema;

export type SupportQuery = z.infer<typeof supportQuerySchema>;

/** Who wrote a message. Mirrors the `message_sender` enum, minus the values a reader never sees. */
export type SupportSender = 'customer' | 'partner' | 'staff' | 'system';

export interface SupportMessage {
  readonly id: string;
  readonly sender: SupportSender;
  /** The body AS STORED — already redacted. The original is never kept. */
  readonly body: string;
  /**
   * How many contact-detail spans were removed on the way in.
   *
   * Shown to the sender rather than hidden: somebody whose phone number was masked should learn that
   * it was, or they will assume it arrived and wait for a call that cannot come.
   */
  readonly redactedCount: number;
  readonly createdAt: string;
}

export interface SupportTicket {
  /** `CNV-000042`, the conversation's own reference. */
  readonly reference: string;
  readonly openedAt: string;
  readonly lastMessageAt: string | null;
  readonly closed: boolean;
  readonly messageCount: number;
  /** The most recent message a non-staff reader is allowed to see, for the list row. */
  readonly lastMessage: string | null;
}

export interface SupportThread extends SupportTicket {
  readonly messages: readonly SupportMessage[];
}
