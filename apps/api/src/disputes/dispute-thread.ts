import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

/**
 * The conversation a dispute opens with.
 *
 * ## The gap this closes
 *
 * `conversations.dispute_id`, its foreign key and `conversations_dispute_idx` have existed since
 * the first migration, and nothing ever wrote the column: every conversation in the platform was a
 * support ticket. The console's inbox has always had a «نزاع» subject kind, a join to `disputes`
 * and a branch printing the dispute's reference — none of it reachable. So an operator settling a
 * complaint had the customer's account of it in one screen, the evidence in another, and no way to
 * ask the one question that would settle it.
 *
 * ## Why a thread of its own rather than the booking's
 *
 * `conversations_exactly_one_subject_v2` is a CHECK, not a convention: a row is about a booking, a
 * dispute, or a partner — exactly one. Attaching a dispute to a booking's thread is not something
 * this schema can express, and the constraint's reasoning is sound where two subjects would put
 * one thread in two inboxes with two different sets of participants.
 *
 * ## Customer and SAFRA, and the partner is NOT in it
 *
 * The same CHECK is what decides this: a row carrying `dispute_id` cannot also carry `partner_id`,
 * so a dispute thread structurally cannot include the host. That is the right shape anyway — a
 * dispute is adjudicated BY SAFRA, and a host reading the complainant's messages live is not
 * adjudication. The host's side is heard through the case itself: their evidence, their contract,
 * their record.
 *
 * ## The complaint IS the first message
 *
 * Not a sentence composed here. A system-written opener would be user-facing copy living in a
 * service — and there is nothing to say that the customer's own words do not already say. The body
 * is the title and the description, already redacted by the caller, so the thread opens with
 * exactly what was filed and the originals are not kept anywhere.
 */
export async function openDisputeThread(
  tx: Database,
  input: {
    readonly disputeId: string;
    readonly customerProfileId: string;
    /** The person who filed it — the customer, or the staff member who took it down. */
    readonly openedByUserId: string | null;
    readonly senderKind: 'customer' | 'staff';
    readonly title: string;
    readonly description: string;
    readonly redactedCount: number;
  },
): Promise<void> {
  /*
    Unread for staff only when somebody else wrote it.

    A staff member who opens a dispute on a customer's behalf has just read what they typed, and a
    thread that arrives unread to its own author inflates the queue badge with staff's own work.
  */
  const unread = input.senderKind === 'customer' ? 1 : 0;

  const created = await tx.execute<{ id: string }>(sql`
    INSERT INTO conversations
      (dispute_id, customer_profile_id, opened_by_user_id, last_message_at, unread_for_staff)
    VALUES (${input.disputeId}::uuid, ${input.customerProfileId}::uuid,
            ${input.openedByUserId}::uuid, now(), ${unread})
    RETURNING id
  `);

  const conversationId = created.rows[0]?.id;

  /*
    Inside the caller's transaction, so a dispute cannot commit without its thread. The pair is the
    point: a case whose conversation silently failed to open is the state this file exists to end.
  */
  if (!conversationId) throw new Error('The dispute conversation was not created.');

  await tx.execute(sql`
    INSERT INTO messages
      (conversation_id, sender_kind, sender_user_id, body, redacted_count, internal)
    VALUES (${conversationId}::uuid, ${input.senderKind}::message_sender,
            ${input.openedByUserId}::uuid,
            ${`${input.title}\n\n${input.description}`}, ${input.redactedCount}, false)
  `);
}
