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
        sql`'BKG-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('booking_reference_seq')::text, 6, '0')`,
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
    index('bookings_customer_idx').on(t.customerProfileId, t.createdAt),
    index('bookings_city_dates_idx').on(t.cityId, t.checkIn),
    index('bookings_unit_dates_idx').on(t.unitId, t.checkIn, t.checkOut),
    index('bookings_created_idx').on(t.createdAt),
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
