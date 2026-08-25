import { relations, sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { createdAt, foreignId, fxRate, money, primaryId, timestamps } from './_shared.js';
import { bookingStatus } from './enums.js';
import { cities, currencies } from './geo.js';
import { customerProfiles, users } from './identity.js';
import { partners } from './partner.js';
import { properties, units } from './property.js';

/**
 * SRS §6. Booking is deliberately NOT instant: the customer pays in full, the
 * booking sits in `pending_confirmation`, and SAFRA has a 2-hour window to get the
 * partner to confirm (§6.4).
 *
 * ── The one constraint that matters most ────────────────────────────────────────
 * EC-005 ("last room, two bookings at the same instant") is enforced in
 * migrations/0001_constraints.sql by a gist EXCLUDE constraint:
 *
 *   EXCLUDE USING gist (unit_id WITH =, daterange(check_in, check_out, '[)') WITH &&)
 *     WHERE (status IN ('pending_confirmation','confirmed','checked_in'))
 *
 * Overlapping stays for one unit are therefore IMPOSSIBLE — the database rejects
 * the second insert. No application race can produce a double booking, including
 * across multiple API nodes, which is precisely why PostgreSQL was chosen.
 *
 * Denormalised propertyId/partnerId/cityId are intentional: admin and partner
 * dashboards filter by them constantly, and joining through units on every query
 * would not hold the §14.1 latency budget.
 */
export const bookings = pgTable(
  'bookings',
  {
    id: primaryId(),
    /** SRS §6.5 / §13.2 — BKG-2026-000001. Year-scoped sequence. */
    reference: text('reference')
      .notNull()
      .unique()
      .default(
        sql`'BKG-' || to_char(now(), 'YYYY') || '-' || reference_number(nextval('booking_reference_seq'))`,
      ),

    customerProfileId: foreignId('customer_profile_id')
      .notNull()
      .references(() => customerProfiles.id),
    unitId: foreignId('unit_id')
      .notNull()
      .references(() => units.id),
    propertyId: foreignId('property_id')
      .notNull()
      .references(() => properties.id),
    partnerId: foreignId('partner_id')
      .notNull()
      .references(() => partners.id),
    cityId: foreignId('city_id')
      .notNull()
      .references(() => cities.id),

    checkIn: date('check_in').notNull(),
    checkOut: date('check_out').notNull(),
    /** Derived in the database so it can never disagree with the dates. */
    nights: integer('nights').generatedAlwaysAs(sql`(check_out - check_in)`),

    guestsAdults: smallint('guests_adults').notNull(),
    guestsChildren: smallint('guests_children').notNull().default(0),
    guestsInfants: smallint('guests_infants').notNull().default(0),

    status: bookingStatus('status').notNull().default('draft'),

    // ── Money ────────────────────────────────────────────────────────────────
    // Rates are SNAPSHOTS, not lookups. SRS §2.1 lets the admin change the 7%
    // commission at any time; historical bookings and finished revenue reports
    // must not silently change when they do.
    baseAmount: money('base_amount').notNull(),
    /**
     * How the customer fee was calculated, snapshotted.
     *
     * The approved settings page charges the customer a FLAT $1.99 while the
     * partner pays a 7% commission — the two sides use different units, so a
     * single "rate" column could not represent both. `mode` + `value` records
     * whichever was configured at booking time, so an admin switching from flat to
     * percentage never rewrites the arithmetic of existing bookings.
     */
    customerFeeMode: text('customer_fee_mode').notNull().default('flat'),
    customerFeeValue: numeric('customer_fee_value', {
      precision: 12,
      scale: 4,
    }).notNull(),
    customerFeeAmount: money('customer_fee_amount').notNull(),
    partnerCommissionRate: numeric('partner_commission_rate', {
      precision: 6,
      scale: 4,
    }).notNull(),
    partnerCommissionAmount: money('partner_commission_amount').notNull(),
    discountAmount: money('discount_amount').notNull().default('0'),
    giftCardAmount: money('gift_card_amount').notNull().default('0'),
    /**
     * Stored value applied to this booking (§7.3), held from the moment a payment
     * attempt succeeds in reaching the gateway until the booking is captured — or
     * credited back if it expires unpaid.
     */
    walletAmount: money('wallet_amount').notNull().default('0'),
    /**
     * The GROSS total: base + customer fee. What the gateway is asked for is
     * `totalAmount - walletAmount - giftCardAmount`.
     *
     * Not reduced when stored value is applied, deliberately. The capture ledger
     * balances on the identity `total = fee + commission + payable`, and netting a
     * wallet payment out of the total would break it — the split belongs on the
     * DEBIT side of that group, not in the booking's own arithmetic.
     */
    totalAmount: money('total_amount').notNull(),
    /** What the partner is owed once entitlement conditions are met (§7.2). */
    partnerPayableAmount: money('partner_payable_amount').notNull(),
    currencyId: foreignId('currency_id')
      .notNull()
      .references(() => currencies.id),
    /** SYP is the internal accounting currency (§1.4); snapshot the rate used. */
    fxRateToSyp: fxRate('fx_rate_to_syp').notNull(),
    totalSyp: numeric('total_syp', { precision: 18, scale: 2 }).notNull(),

    /**
     * The cancellation policy AS IT STOOD when the customer agreed to it. The
     * policy row may be edited later; the terms of this contract may not.
     */
    cancellationPolicySnapshot: jsonb('cancellation_policy_snapshot').notNull(),

    // ── Confirmation SLA (§6.4) ──────────────────────────────────────────────
    paidAt: timestamp('paid_at', { withTimezone: true }),
    /** paidAt + configurable window (default 2h). Drives the BullMQ delayed job. */
    confirmationDeadlineAt: timestamp('confirmation_deadline_at', { withTimezone: true }),
    partnerRespondedAt: timestamp('partner_responded_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedByUserId: foreignId('confirmed_by_user_id').references(() => users.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByUserId: foreignId('cancelled_by_user_id').references(() => users.id),
    /**
     * Why the booking was cancelled: either a `system.*` CODE or a person's own words.
     *
     * The three cancellations this platform decides for itself store a code —
     * `system.payment_expired`, `system.partner_no_response`, `system.partner_rejected` — which
     * the reader's locale resolves at render. They used to store English sentences, so an Arabic
     * console printed "Payment not completed within the allowed window (EC-001)."
     * (Bashar, 2026-08-06).
     *
     * A cancellation someone TYPED is stored verbatim and shown verbatim: it is that person's
     * statement about a booking, and paraphrasing it is not this system's job. Rows written
     * before the change still hold English and still render as written, which is why the
     * resolver falls back to the raw value instead of to a placeholder — no migration, and no
     * row loses its reason.
     */
    cancellationReason: text('cancellation_reason'),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    /** §5.2 trip attributes the customer searched with — feeds recommendations. */
    searchAttributes: text('search_attributes').array().notNull().default([]),
    /** Internal staff notes, never visible to customer or partner (§9.4). */
    internalNotes: text('internal_notes'),

    /**
     * Authorizes a GUEST to act on this booking — currently to pay for it.
     *
     * §4 permits booking with no account, so at the moment payment starts there is
     * no session to check. The reference cannot serve as the credential: §13.2
     * makes it a year-scoped sequence (`BKG-2026-000042`), so anyone can guess a
     * live one and, without this, pay for or read a stranger's booking.
     *
     * SHA-256 rather than Argon2id deliberately: this is a 256-bit random secret,
     * not a human password, so there is no dictionary to slow down and a fast hash
     * keeps the payment path cheap. Stored hashed so a database read cannot be
     * turned into the ability to act on bookings.
     */
    accessTokenHash: text('access_token_hash'),
    /** Tracks the payment window; a token outliving its purpose is a liability. */
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),

    /** §15 requires IP and device on sensitive operations. */
    createdIp: text('created_ip'),
    createdUserAgent: text('created_user_agent'),
    ...timestamps,
  },
  (t) => [
    // Admin "needs your attention now" (§9.2): bookings whose SLA is about to lapse.
    index('bookings_sla_idx')
      .on(t.status, t.confirmationDeadlineAt)
      .where(sql`status = 'pending_confirmation'`),
    index('bookings_partner_status_idx').on(t.partnerId, t.status),
    /**
     * The registry's per-status COUNTS, and nothing else — see the last paragraph.
     *
     * `booking-list.service.ts` described its counts as "one grouped query over the
     * `(status, created_at)` index", an index that did not exist. Grouping by a column no index
     * leads on has one plan available: read the whole table. Measured against 5,000,061 rows on
     * 2026-08-20:
     *
     *   - the unfiltered status counts read **239,855 buffers, on every page view** of the registry;
     *   - a capped count for a status with NO rows still read 5,058 buffers, because proving an
     *     absence without a range means scanning for it — so `COUNT_CAP` alone did not bound them.
     *
     * With this index and the counts capped per status, the whole set costs **93 buffers** and stays
     * bounded however large the table grows.
     *
     * ## What it does NOT do, so nobody adds a second one expecting it to
     *
     * It does not serve `?status=…&` ORDER BY. Two reasons, both measured: the planner prefers a
     * backward scan of `bookings_created_idx` with a filter (46 buffers for page 1 of `confirmed`,
     * which is cheaper than this index plus heap fetches), and drizzle's `.desc()` emits
     * `DESC NULLS LAST` while a plain `ORDER BY … DESC` means `NULLS FIRST` — so the orderings do
     * not match and no sort could be removed even if the planner wanted to. See §8 of
     * `docs/FUTURE-WORK.md`.
     *
     * Cost, stated: one more btree on the busiest write table in the schema, 34 MB at 5M rows.
     */
    index('bookings_status_created_idx').on(t.status, t.createdAt.desc()),
    index('bookings_customer_idx').on(t.customerProfileId, t.createdAt),
    index('bookings_city_dates_idx').on(t.cityId, t.checkIn),
    index('bookings_unit_dates_idx').on(t.unitId, t.checkIn, t.checkOut),
    index('bookings_created_idx').on(t.createdAt),
  ],
);

/**
 * Staff prose about one booking, never shown to the customer or the partner (§9.4).
 *
 * ## Why a table and not `bookings.internal_notes`
 *
 * That column exists and is a single `text`, so the second person to write a note would
 * OVERWRITE the first — losing what it said, when it was written and who wrote it. That exact
 * defect was reported on a different screen (`O-partner-7`, 2026-08-20: "a second telephone call
 * erased the first one's note") and answered by `partner_application_contacts`. This is the same
 * answer to the same shape, and the column is left alone: it holds nothing, no route ever wrote
 * it, and dropping it is a migration that buys nothing today.
 *
 * ## Append-only, deliberately
 *
 * `createdAt` rather than `...timestamps`, which is this codebase's marker for a table nobody may
 * amend — "a row that can be amended is not an audit trail" (`_shared.ts`). Support notes are the
 * record of what was known when a decision was taken, so a note that was wrong is corrected by
 * writing another one rather than by editing it into agreement with the outcome.
 *
 * ## It carries the same erasure tension as the call log
 *
 * This is staff prose ABOUT a named customer, attached by foreign key to a booking that carries
 * their name, address and telephone number — the same collision `O-sec-8` records for
 * `partner_application_contacts`. It is one more table for the retention and erasure
 * reconciliation, and better recorded there now than discovered during it.
 */
export const bookingInternalNotes = pgTable(
  'booking_internal_notes',
  {
    id: primaryId(),
    bookingId: foreignId('booking_id')
      .notNull()
      .references(() => bookings.id),
    /**
     * Who wrote it. Nullable for the reason the call log's author column is: a staff account can
     * be removed, and losing the note because we lost its author is the worse trade.
     */
    authorUserId: foreignId('author_user_id').references(() => users.id),
    /** What they wrote. Never empty — the endpoint rejects a blank note before it reaches here. */
    note: text('note').notNull(),
    ...createdAt,
  },
  (t) => [
    /**
     * The notes on one booking, oldest first.
     *
     * ASCENDING, and that is deliberate rather than careless. `booking_id` is an equality
     * predicate, so the remaining order is `created_at` alone and PostgreSQL reads this index
     * BACKWARD when a caller wants the newest. Writing it `.desc()` would emit `DESC NULLS LAST`,
     * which does not match PostgreSQL's own `ORDER BY … DESC` (`NULLS FIRST`) — the mismatch that
     * cost `partner_application_contacts` a sequential scan at 765 buffers on 2026-08-20.
     */
    index('booking_internal_notes_booking_idx').on(t.bookingId, t.createdAt),
  ],
);

/**
 * SRS §13.1 "Timeline Event" + P-004 (everything traceable). Append-only: the
 * SQL migration revokes UPDATE and DELETE. Polymorphic by design so a booking,
 * partner or customer timeline all read from one place.
 */
export const timelineEvents = pgTable(
  'timeline_events',
  {
    id: primaryId(),
    subjectType: text('subject_type').notNull(), // booking | partner | customer | property
    subjectId: foreignId('subject_id').notNull(),
    eventType: text('event_type').notNull(), // booking.paid | partner.confirmed | …
    /** "system" | "customer" | "partner" | "staff" */
    actorType: text('actor_type').notNull().default('system'),
    actorUserId: foreignId('actor_user_id').references(() => users.id),
    payload: jsonb('payload'),
    /** Rendered per locale at read time from eventType + payload, not stored. */
    ...createdAt,
  },
  (t) => [
    index('timeline_events_subject_idx').on(t.subjectType, t.subjectId, t.createdAt),
    index('timeline_events_type_idx').on(t.eventType),
  ],
);

export const bookingsRelations = relations(bookings, ({ one }) => ({
  customerProfile: one(customerProfiles, {
    fields: [bookings.customerProfileId],
    references: [customerProfiles.id],
  }),
  unit: one(units, { fields: [bookings.unitId], references: [units.id] }),
  property: one(properties, {
    fields: [bookings.propertyId],
    references: [properties.id],
  }),
  partner: one(partners, { fields: [bookings.partnerId], references: [partners.id] }),
  city: one(cities, { fields: [bookings.cityId], references: [cities.id] }),
  currency: one(currencies, {
    fields: [bookings.currencyId],
    references: [currencies.id],
  }),
}));
