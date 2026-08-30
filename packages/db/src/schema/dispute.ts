import { relations, sql } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { createdAt, foreignId, money, primaryId, timestamps } from './_shared.js';
import { disputeStatus } from './enums.js';
import { bookings } from './booking.js';
import { currencies } from './geo.js';
import { customerProfiles, users } from './identity.js';
import { partners } from './partner.js';

/**
 * Why a dispute was opened.
 *
 * The EC codes are the SRS's own edge-case numbers, and they are the vocabulary staff already
 * use on the phone — "this is an EC-006" carries the whole playbook. `complaint` is the
 * catch-all for a grievance that is not one of the defined failures.
 */
export const disputeKind = pgEnum('dispute_kind', [
  /** EC-006: the property was closed or unavailable on arrival. */
  'property_unavailable',
  /** EC-007: the unit did not match its photos or description. */
  'not_as_described',
  /** EC-008: the partner never responded within the confirmation window. */
  'partner_no_response',
  /** Anything else a customer raises. */
  'complaint',
]);

/**
 * A dispute (SRS §10, design handoff §8).
 *
 * ## Why disputes are their own table rather than a booking status
 *
 * `bookings.status` already has a `disputed` value, and that was briefly argued to be enough.
 * It is not: a booking can be disputed twice for different reasons, a dispute outlives the
 * booking's own lifecycle (it can be opened after checkout and closed weeks later), and the
 * resolution carries money — a compensation amount that has to reconcile against the wallet
 * and the ledger. A status flag can hold none of that.
 *
 * ## The payout freeze is DERIVED, never a flag
 *
 * The handoff's rule is that opening a dispute freezes the partner's payout for that booking.
 * That is expressed as a query — "does this booking have a dispute that is not resolved or
 * rejected" — rather than a `payout_frozen` boolean on the booking. A denormalised flag has
 * exactly one failure mode and it is unacceptable here: the flag and the disputes disagree,
 * and money moves on the strength of the stale one. See `DisputeService.frozenBookingIds`.
 *
 * ## Closing requires a resolution
 *
 * `resolution` is enforced non-null-when-closed by a CHECK in migrations/post. A dispute
 * closed with no stated outcome is unauditable, and this is the record a customer, a partner
 * or an insurer asks to see.
 */
export const disputes = pgTable(
  'disputes',
  {
    id: primaryId(),
    /** §13.2 — `DSP-000112`. The sequence was provisioned in migrations/pre from the start. */
    reference: text('reference')
      .notNull()
      .unique()
      .default(sql`'DSP-' || reference_number(nextval('dispute_reference_seq'))`),

    bookingId: foreignId('booking_id')
      .notNull()
      .references(() => bookings.id),
    /**
     * Denormalised from the booking, deliberately.
     *
     * The dispute queue is filtered and counted by partner constantly — "how many open
     * disputes does this partner have" drives their score — and joining through bookings for
     * every one of those reads is the difference between an index scan and a nested loop over
     * three thousand rows. It cannot drift: a booking never changes partner.
     */
    partnerId: foreignId('partner_id')
      .notNull()
      .references(() => partners.id),
    customerProfileId: foreignId('customer_profile_id')
      .notNull()
      .references(() => customerProfiles.id),

    kind: disputeKind('kind').notNull(),
    status: disputeStatus('status').notNull().default('open'),
    /** One line, as the design's card shows it. */
    title: text('title').notNull(),
    /** The customer's own account, verbatim. Never summarised into the title. */
    description: text('description'),

    /**
     * Compensation agreed on closing, if any.
     *
     * Recorded here as the DECISION; the money itself moves as a wallet transaction and a
     * ledger group. Two records of one payment would be one record too many, so this is the
     * amount that was agreed and `wallet_transactions` is the amount that was paid.
     */
    compensationAmount: money('compensation_amount'),
    compensationCurrencyId: foreignId('compensation_currency_id').references(
      () => currencies.id,
    ),

    /** Null when the customer raised it through the app rather than a staff member. */
    openedByUserId: foreignId('opened_by_user_id').references(() => users.id),
    assignedToUserId: foreignId('assigned_to_user_id').references(() => users.id),

    resolution: text('resolution'),
    closedByUserId: foreignId('closed_by_user_id').references(() => users.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    /** The queue: open disputes oldest first, which is how the design orders them. */
    index('disputes_status_idx').on(t.status, t.createdAt),
    index('disputes_booking_idx').on(t.bookingId),
    index('disputes_partner_idx').on(t.partnerId, t.status),
    index('disputes_customer_idx').on(t.customerProfileId),
  ],
);

/**
 * Evidence attached to a dispute — EC-007's customer photos above all.
 *
 * Append-only in the sense that matters: nothing is ever UPDATED or physically deleted. A row can
 * be RETIRED — `deletedAt` — and that is not a weakening of the rule, it is the rule surviving
 * contact with the world. This table was built with no removal at all, on the reasoning that
 * «evidence that can be edited or removed after the fact is not evidence». That is right about the
 * record and wrong about the frame: a photograph gets filed by mistake, twice, or with somebody
 * else's face and address in it, and a file that can never be corrected is its own integrity
 * problem — and a compliance one where the frame holds personal data nobody consented to.
 *
 * So removal is a soft delete with `dispute.evidence_removed` in the audit log beside it: the row
 * stays, who removed it and when is answerable, and it stops counting and stops being served. A
 * closed dispute takes no removals, for the same reason it takes no additions — the resolution
 * must stay readable against what was in front of the person who wrote it.
 *
 * The bytes live in object storage behind the same abstraction as partner documents; this
 * table holds the key. No file is served without an authorization check per request.
 */
export const disputeEvidence = pgTable(
  'dispute_evidence',
  {
    id: primaryId(),
    disputeId: foreignId('dispute_id')
      .notNull()
      .references(() => disputes.id),
    /** `photo` or `document`. Free text rather than an enum: the set will grow. */
    kind: text('kind').notNull().default('photo'),
    fileName: text('file_name').notNull(),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /**
     * The widths the renderer actually produced — `null` until it has run.
     *
     * Not a weakening of «append-only»: it records what the PIPELINE wrote, not anything a person
     * said. It exists because the pipeline never upscales, so a URL asking for a fixed width can
     * address an object that was never written — the defect that shipped on ad creatives on
     * 2026-08-27. Null doubles as the only status this table needs: the row exists once the bytes
     * are stored, and the picture appears when the worker has finished.
     */
    variantWidths: integer('variant_widths').array(),
    /** Null when the customer uploaded it. */
    uploadedByUserId: foreignId('uploaded_by_user_id').references(() => users.id),
    /** Retired rather than destroyed — see the note above. Who did it is in the audit log. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...createdAt,
  },
  (t) => [index('dispute_evidence_dispute_idx').on(t.disputeId, t.createdAt)],
);

export const disputesRelations = relations(disputes, ({ one, many }) => ({
  booking: one(bookings, { fields: [disputes.bookingId], references: [bookings.id] }),
  partner: one(partners, { fields: [disputes.partnerId], references: [partners.id] }),
  customer: one(customerProfiles, {
    fields: [disputes.customerProfileId],
    references: [customerProfiles.id],
  }),
  evidence: many(disputeEvidence),
}));

export const disputeEvidenceRelations = relations(disputeEvidence, ({ one }) => ({
  dispute: one(disputes, {
    fields: [disputeEvidence.disputeId],
    references: [disputes.id],
  }),
}));
