import { relations, sql } from 'drizzle-orm';
import {
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { bookings } from './booking.js';
import { reviewReportStatus, reviewStatus } from './enums.js';
import { customerProfiles, users } from './identity.js';
import { partners } from './partner.js';
import { properties, units } from './property.js';
import { foreignId, primaryId, timestamps } from './_shared.js';

/**
 * Guest reviews (design handoff §7.3, P-006).
 *
 * ## P-006 is a property of this table, not of a code path
 *
 * *"لا يمكن حذف تقييم — يمكنك الرد عليه أو الإبلاغ عنه"*. There is no `deleted_at` here and a
 * trigger refuses `DELETE` outright (`post/0004_review_constraints.sql`), so "delete this review"
 * is not something any service can be asked to do, however it is called. A review that should not
 * be shown becomes `hidden` — a moderation decision carrying an actor, a timestamp and a note.
 *
 * The same trigger freezes `rating` and `body` after insert. A review whose text could be edited
 * is not a review, it is a claim about what somebody said; and the partner's reply quoting a
 * sentence that no longer exists is how that becomes visible far too late.
 *
 * ## Why a review is tied to a BOOKING and not to a property
 *
 * One review per booking, by unique index. A booking is proof that this person stayed at this
 * unit, so it is the only thing that makes a review more than an opinion from a stranger — and it
 * is what stops a partner's competitor, or a partner's friend, writing about a stay that never
 * happened. `properties.rating` feeds the search ranking at the heaviest weight in the model
 * (`WEIGHTS.rating = 3.5`, "the strongest signal"), which makes an unearned review a ranking
 * exploit rather than a rudeness.
 *
 * The property, unit and partner are denormalised alongside because a review outlives the shape of
 * a booking: they are what every read filters on, and joining through `bookings` for the partner's
 * own list would put a four-table join on the screen §7.3 loads first.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: primaryId(),
    reference: text('reference')
      .notNull()
      .unique()
      .default(sql`'REV-' || lpad(nextval('review_reference_seq')::text, 6, '0')`),

    /** The stay this is about. Unique — one review per booking, enforced below. */
    bookingId: foreignId('booking_id')
      .notNull()
      .references(() => bookings.id),
    propertyId: foreignId('property_id')
      .notNull()
      .references(() => properties.id),
    unitId: foreignId('unit_id')
      .notNull()
      .references(() => units.id),
    partnerId: foreignId('partner_id')
      .notNull()
      .references(() => partners.id),
    customerProfileId: foreignId('customer_profile_id')
      .notNull()
      .references(() => customerProfiles.id),

    /** 1–5, checked in the database. The ★ score §7.3 prints. */
    rating: smallint('rating').notNull(),
    body: text('body').notNull(),

    status: reviewStatus('status').notNull().default('published'),

    /**
     * الرد — the partner's answer, shown under the review.
     *
     * One reply rather than a thread. §7.3 draws a single «الرد» button, and a conversation
     * between a partner and a departed guest belongs in the messaging system, which already
     * strips contact details and keeps SAFRA in the middle.
     */
    partnerReply: text('partner_reply'),
    partnerRepliedAt: timestamp('partner_replied_at', { withTimezone: true }),

    /** إبلاغ — the partner's recourse, which is to ask SAFRA to look, never to remove. */
    reportStatus: reviewReportStatus('report_status').notNull().default('none'),
    reportReason: text('report_reason'),
    reportedAt: timestamp('reported_at', { withTimezone: true }),

    /** Who decided what to do about it, so a hidden review is answerable. */
    moderatedByUserId: foreignId('moderated_by_user_id').references(() => users.id),
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),
    moderationNote: text('moderation_note'),

    ...timestamps,
  },
  (t) => [
    /* One review per stay. The rule that makes a rating mean something. */
    uniqueIndex('reviews_booking_unique').on(t.bookingId),
    /* §7.3's list: this partner's reviews, newest first. */
    index('reviews_partner_idx').on(t.partnerId, t.createdAt),
    /* The customer site's per-property list, and the aggregate recompute. */
    index('reviews_property_idx').on(t.propertyId, t.status),
    /*
      تقييماتي — the reviews one customer WROTE, newest first.

      Added with that screen: `mineForCustomer` filters on `customer_profile_id` and pages by keyset
      on `(created_at, id)`, and without this the filter was a sequential scan of every review on the
      platform on a request path — which is the thing rule 2 forbids rather than a slow query to
      accept. Mirrors `reviews_partner_idx`, which exists for the same shape of read.
    */
    index('reviews_customer_idx').on(t.customerProfileId, t.createdAt),
    /* The staff moderation queue: everything a partner has reported. */
    index('reviews_reported_idx').on(t.reportStatus, t.reportedAt),
  ],
);

export const reviewsRelations = relations(reviews, ({ one }) => ({
  booking: one(bookings, { fields: [reviews.bookingId], references: [bookings.id] }),
  property: one(properties, {
    fields: [reviews.propertyId],
    references: [properties.id],
  }),
  unit: one(units, { fields: [reviews.unitId], references: [units.id] }),
  partner: one(partners, { fields: [reviews.partnerId], references: [partners.id] }),
  customer: one(customerProfiles, {
    fields: [reviews.customerProfileId],
    references: [customerProfiles.id],
  }),
}));
