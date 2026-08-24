import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { createdAt, foreignId, primaryId, timestamps } from './_shared.js';
import { notificationChannel, notificationStatus } from './enums.js';
import { bookings } from './booking.js';
import { customerProfiles, users } from './identity.js';
import { disputes } from './dispute.js';
import { partners } from './partner.js';

/** Who wrote a message. `system` covers automated notices posted into a thread. */
export const messageSender = pgEnum('message_sender', [
  'customer',
  'partner',
  'staff',
  'system',
]);

/**
 * A three-party conversation: customer ↔ SAFRA ↔ partner (SRS §10, design handoff §8).
 *
 * ## Why one thread with three parties rather than two threads
 *
 * The handoff is explicit — "سفرة تراقب وتوجّه" — SAFRA watches and steers. Two separate
 * two-party threads would mean staff reading a customer's complaint and a partner's account of
 * the same night in different places, and would make "who said what, when" unanswerable. One
 * ordered thread is the record.
 *
 * ## Subject, not owner
 *
 * A conversation hangs off whatever it is ABOUT: a booking, a dispute, or a partner
 * relationship with no booking attached (pricing, calendar). Exactly one of the three is set,
 * enforced by a CHECK in migrations/post — a thread about nothing cannot be routed to anybody.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: primaryId(),
    /** `CNV-000042`. Its own sequence, added alongside this table. */
    reference: text('reference')
      .notNull()
      .unique()
      .default(sql`'CNV-' || reference_number(nextval('conversation_reference_seq'))`),

    bookingId: foreignId('booking_id').references(() => bookings.id),
    disputeId: foreignId('dispute_id').references(() => disputes.id),
    partnerId: foreignId('partner_id').references(() => partners.id),
    customerProfileId: foreignId('customer_profile_id').references(
      () => customerProfiles.id,
    ),

    /**
     * WHO opened this thread — the person, not the party.
     *
     * A partner-side thread belongs to a BUSINESS, and until employees existed a business was one
     * person, so `partner_id` answered both "whose thread is this" and "who may read it". It no
     * longer does: a receptionist and the owner both carry the same `partner_id`, and the owner's
     * correspondence with SAFRA is where a payout dispute, a contract question or a complaint
     * ABOUT that receptionist gets written down.
     *
     * So the owner reads every thread on the business and an employee reads only their own, and
     * this column is the difference. NULL on every row written before it existed, which excludes
     * those rows from an employee's scope — the safe direction, and the reason no backfill is
     * needed or would be correct.
     */
    openedByUserId: foreignId('opened_by_user_id').references(() => users.id),

    /**
     * Denormalised so the inbox can sort without touching `messages`.
     *
     * The list is ordered by most recent activity and paged by it. Deriving it with
     * `max(created_at)` per conversation is a correlated aggregate over the biggest table in
     * the domain, on every page load. Updated in the same transaction as the message insert,
     * so it cannot lag.
     */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    /**
     * Unread FOR STAFF specifically.
     *
     * The design's red badge is a staff work queue, not a per-participant count: the question
     * it answers is "how many threads are waiting on us". A customer's own unread count belongs
     * to the customer app and is a different number.
     */
    unreadForStaff: integer('unread_for_staff').notNull().default(0),
    closedAt: timestamp('closed_at', { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    /** The inbox: most recent first. */
    index('conversations_recent_idx').on(t.lastMessageAt),
    index('conversations_booking_idx').on(t.bookingId),
    index('conversations_dispute_idx').on(t.disputeId),
    index('conversations_partner_idx').on(t.partnerId),
    /**
     * An employee's own threads: `partner_id = ? AND opened_by_user_id = ?`.
     *
     * Leading with `partner_id` so this index also serves the OWNER's read, which filters on that
     * column alone — one index for both partner-side scopes rather than a second one that would
     * duplicate the first's leading column.
     */
    index('conversations_partner_opener_idx').on(t.partnerId, t.openedByUserId),
    /** The badge query — threads with anything waiting on staff. */
    index('conversations_unread_idx').on(t.unreadForStaff),
  ],
);

/**
 * One message in a thread.
 *
 * Append-only by trigger (see migrations/post): a message that can be edited after the fact
 * makes the whole thread worthless as a record of what was actually said, which is precisely
 * what it is consulted for when a dispute turns on a promise somebody made.
 *
 * ## Contact details are redacted on the way IN
 *
 * The handoff's rule: phone numbers and direct contact details may not be exchanged before a
 * booking is confirmed, and are blocked automatically. `body` therefore stores the REDACTED
 * text and `redactedCount` records how many spans were removed, so staff can see that an
 * attempt happened. The original is deliberately NOT kept: storing it would recreate exactly
 * the leak the rule exists to prevent, and "we blocked it but kept a copy" is not a rule.
 */
export const messages = pgTable(
  'messages',
  {
    id: primaryId(),
    conversationId: foreignId('conversation_id')
      .notNull()
      .references(() => conversations.id),
    senderKind: messageSender('sender_kind').notNull(),
    /** Set for staff and, where the account exists, for customer and partner senders. */
    senderUserId: foreignId('sender_user_id').references(() => users.id),
    body: text('body').notNull(),
    /** How many contact-detail spans were removed. Zero for a clean message. */
    redactedCount: integer('redacted_count').notNull().default(0),
    /**
     * An internal note is visible to STAFF ONLY.
     *
     * The same thread carries both the conversation and the staff commentary on it, because
     * separating them means reading two timelines to reconstruct one incident. The flag is what
     * keeps the note out of the customer app, and it is checked on read, not on write.
     */
    internal: boolean('internal').notNull().default(false),
    ...createdAt,
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)],
);

/**
 * The WhatsApp and email delivery log (design handoff §8, واتساب والبريد).
 *
 * ## What this is, and what it is not
 *
 * It is the RECORD of what the platform tried to send and what happened. It is not a queue —
 * sending runs through the background worker — and it is not the templates, which are code.
 *
 * ## No recipient address is stored
 *
 * The obvious column here is `recipient`, holding a phone number or an email. It is absent on
 * purpose: rule 1 forbids full PII in logs, this table is read by every support agent, and the
 * address is already on the customer or partner row that `customerProfileId` points at. Storing
 * it twice would put a directory of contactable people in a table that never gets deleted, to
 * save one join.
 *
 * ## Attempts are counted, and failures keep their reason
 *
 * The design shows "فشلت — إعادة تلقائية". A retry that overwrote the previous attempt's error
 * would hide the pattern that matters — the same template failing for every German recipient is
 * a bug, three unrelated failures are the network.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: primaryId(),
    channel: notificationChannel('channel').notNull(),
    /** Template identifier, e.g. `booking.confirmed`. Matched against a code-side catalogue. */
    templateKey: text('template_key').notNull(),
    /** `ar` | `en` | `de` — which of the three language variants was sent. */
    locale: text('locale').notNull(),
    status: notificationStatus('status').notNull().default('queued'),

    bookingId: foreignId('booking_id').references(() => bookings.id),
    disputeId: foreignId('dispute_id').references(() => disputes.id),
    customerProfileId: foreignId('customer_profile_id').references(
      () => customerProfiles.id,
    ),
    partnerId: foreignId('partner_id').references(() => partners.id),

    /** The provider's own message id, for reconciling against their dashboard. */
    providerRef: text('provider_ref'),
    attempts: integer('attempts').notNull().default(0),
    /** The last failure, in the provider's words. Never contains the recipient. */
    failureReason: text('failure_reason'),

    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    /** The log, newest first — the design's default view. */
    index('notifications_recent_idx').on(t.createdAt),
    index('notifications_status_idx').on(t.status, t.createdAt),
    index('notifications_booking_idx').on(t.bookingId),
    index('notifications_template_idx').on(t.templateKey, t.channel),
  ],
);

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  booking: one(bookings, {
    fields: [conversations.bookingId],
    references: [bookings.id],
  }),
  dispute: one(disputes, {
    fields: [conversations.disputeId],
    references: [disputes.id],
  }),
  partner: one(partners, {
    fields: [conversations.partnerId],
    references: [partners.id],
  }),
  customer: one(customerProfiles, {
    fields: [conversations.customerProfileId],
    references: [customerProfiles.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));
