import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { foreignId, money, notDeleted, primaryId, timestamps } from './_shared.js';
import { dayStatus, propertyStatus } from './enums.js';
import { cities, currencies } from './geo.js';
import { partners } from './partner.js';
import { users } from './identity.js';

/** SRS §8.2 ends with "other types addable by the admin" — hence a table. */
export const propertyTypes = pgTable('property_types', {
  id: primaryId(),
  code: text('code').notNull().unique(), // hotel | apartment | villa | farm | chalet | rural_house | camp
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  nameDe: text('name_de').notNull(),
  /** Hotels have rooms under one roof; a villa is a single unit. Changes UX. */
  hasMultipleUnits: boolean('has_multiple_units').notNull().default(false),
  glyph: text('glyph'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

/** Admin-managed so a new filter (§5.5) needs no deploy. */
export const amenities = pgTable('amenities', {
  id: primaryId(),
  code: text('code').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  nameDe: text('name_de').notNull(),
  /** Grouped in the filter sidebar: "facilities" | "rules" | "accessibility". */
  category: text('category').notNull().default('facilities'),
  isFilterable: boolean('is_filterable').notNull().default(true),
  icon: text('icon'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

/**
 * SRS §7.4: a partner picks from ready-made policies that SAFRA approves — they
 * cannot invent their own terms. The 50% refund floor is enforced by a CHECK
 * constraint in the SQL migration, not just by application code.
 */
export const cancellationPolicies = pgTable('cancellation_policies', {
  id: primaryId(),
  code: text('code').notNull().unique(), // flex | moderate | strict
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  nameDe: text('name_de').notNull(),
  descriptionAr: text('description_ar').notNull(),
  descriptionEn: text('description_en').notNull(),
  descriptionDe: text('description_de').notNull(),
  /** Tiers: [{ hoursBeforeCheckIn: 48, refundPercent: 100 }, …] */
  tiers: jsonb('tiers')
    .$type<{ hoursBeforeCheckIn: number; refundPercent: number }[]>()
    .notNull(),
  minRefundPercent: smallint('min_refund_percent').notNull().default(50),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

export const properties = pgTable(
  'properties',
  {
    id: primaryId(),
    reference: text('reference')
      .notNull()
      .unique()
      .default(sql`'PRO-' || lpad(nextval('property_reference_seq')::text, 6, '0')`),
    partnerId: foreignId('partner_id')
      .notNull()
      .references(() => partners.id),
    cityId: foreignId('city_id')
      .notNull()
      .references(() => cities.id),
    propertyTypeId: foreignId('property_type_id')
      .notNull()
      .references(() => propertyTypes.id),
    slug: text('slug').notNull(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    nameDe: text('name_de').notNull(),
    descriptionAr: text('description_ar'),
    descriptionEn: text('description_en'),
    descriptionDe: text('description_de'),
    address: text('address').notNull(),
    latitude: text('latitude'),
    longitude: text('longitude'),

    status: propertyStatus('status').notNull().default('draft'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedByUserId: foreignId('verified_by_user_id').references(() => users.id),
    /**
     * Why a submission was rejected (§8.1). The partner must be able to read this —
     * a rejection with no explanation just produces a support ticket and a
     * resubmission of the same listing.
     */
    reviewNotes: text('review_notes'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    cancellationPolicyId: foreignId('cancellation_policy_id')
      .notNull()
      .references(() => cancellationPolicies.id),

    /** Denormalised from reviews for sort/filter performance; worker-maintained. */
    rating: numeric('rating', { precision: 2, scale: 1 }),
    reviewsCount: integer('reviews_count').notNull().default(0),
    /** Earned badges: "safra_verified", "safra_recommends" (§5.6). */
    badges: text('badges').array().notNull().default([]),
    /**
     * Trip attributes from §5.2's "صفات الرحلة" filter — sea, mountain, history,
     * nature, families, honeymoon, pool, parking, internet, business.
     *
     * Stored on the PROPERTY rather than inferred from city categories or
     * amenities. Inference would be wrong in both directions: a coastal city
     * contains inland properties, and "honeymoon" or "business" correspond to no
     * amenity at all. Tagging is explicit, and the GIN index makes filtering cheap.
     */
    attributes: text('attributes').array().notNull().default([]),
    /** Cached ranking input for "SAFRA recommends" (§5.5); recomputed nightly. */
    recommendationScore: numeric('recommendation_score', { precision: 6, scale: 3 })
      .notNull()
      .default('0'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('properties_slug_unique').on(t.slug).where(notDeleted),
    // The search path: published properties in a city, ordered by recommendation.
    index('properties_search_idx').on(t.cityId, t.status, t.recommendationScore),
    index('properties_partner_idx').on(t.partnerId),
    index('properties_type_idx').on(t.propertyTypeId),
    index('properties_attributes_idx').using('gin', t.attributes),
  ],
);

export const propertyImages = pgTable(
  'property_images',
  {
    id: primaryId(),
    propertyId: foreignId('property_id')
      .notNull()
      .references(() => properties.id),
    fileKey: text('file_key').notNull(),
    altAr: text('alt_ar'),
    altEn: text('alt_en'),
    altDe: text('alt_de'),
    width: integer('width'),
    height: integer('height'),
    /**
     * The widths actually rendered for this image.
     *
     * The pipeline never upscales, so a 1200 px source yields 400/800/1200 — not
     * the nominal 400/800/1600. Storing the real set is the only way the frontend
     * can request a variant that exists; recomputing the rule client-side means two
     * copies of it that silently drift apart.
     */
    variantWidths: integer('variant_widths').array().notNull().default([]),
    isCover: boolean('is_cover').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('property_images_property_idx').on(t.propertyId, t.sortOrder)],
);

/**
 * The bookable entity — ONE physical unit per row, always.
 *
 * A hotel with 8 identical double rooms gets 8 rows sharing a `roomTypeCode`, not
 * one row with quantity = 8. That is deliberate and load-bearing: the exclusion
 * constraint on `bookings` keys on unit_id, so a row representing 8 rooms would
 * have its second concurrent booking rejected as an overlap.
 *
 * Search and pricing group by `roomTypeCode` for display ("Double room — 8 left"),
 * while booking still targets a single unit. This keeps the double-booking
 * guarantee absolute rather than trading it for a counter that needs locking.
 */
export const units = pgTable(
  'units',
  {
    id: primaryId(),
    propertyId: foreignId('property_id')
      .notNull()
      .references(() => properties.id),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    nameDe: text('name_de').notNull(),
    maxGuests: smallint('max_guests').notNull(),
    bedrooms: smallint('bedrooms').notNull().default(1),
    beds: smallint('beds').notNull().default(1),
    bathrooms: smallint('bathrooms').notNull().default(1),
    /** Fallback nightly price; availabilityDays.price overrides per date. */
    basePrice: money('base_price').notNull(),
    currencyId: foreignId('currency_id')
      .notNull()
      .references(() => currencies.id),
    minNights: smallint('min_nights').notNull().default(1),
    maxNights: smallint('max_nights'),
    /**
     * Groups interchangeable units for display and pricing, e.g. "double_sea_view".
     * Null for one-of-a-kind units (a villa, a farm). NOT a quantity — see above.
     */
    roomTypeCode: text('room_type_code'),
    /** Physical identifier the partner uses at check-in, e.g. "Room 204". */
    unitLabel: text('unit_label'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('units_property_idx').on(t.propertyId),
    index('units_room_type_idx').on(t.propertyId, t.roomTypeCode),
  ],
);

export const unitAmenities = pgTable(
  'unit_amenities',
  {
    unitId: foreignId('unit_id')
      .notNull()
      .references(() => units.id),
    amenityId: foreignId('amenity_id')
      .notNull()
      .references(() => amenities.id),
  },
  (t) => [
    primaryKey({ columns: [t.unitId, t.amenityId] }),
    index('unit_amenities_amenity_idx').on(t.amenityId),
  ],
);

/**
 * SRS §8.4: one calendar row per unit per date. This is the largest table in the
 * system, so it stays deliberately narrow, and the SQL migration partitions it by
 * year — pruning old partitions is how it stays fast at 1M users.
 *
 * `status` here is the PARTNER's declared availability. It is not the source of
 * truth for whether a booking may be created — that is the exclusion constraint on
 * `bookings`. Keeping the two separate is what prevents a calendar-write race from
 * producing a double booking.
 */
export const availabilityDays = pgTable(
  'availability_days',
  {
    unitId: foreignId('unit_id')
      .notNull()
      .references(() => units.id),
    date: date('date').notNull(),
    status: dayStatus('status').notNull().default('available'),
    /** Null = fall back to units.basePrice. */
    price: money('price'),
    minNights: smallint('min_nights'),
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.unitId, t.date] }),
    index('availability_days_date_idx').on(t.date, t.status),
  ],
);

export const propertiesRelations = relations(properties, ({ one, many }) => ({
  partner: one(partners, { fields: [properties.partnerId], references: [partners.id] }),
  city: one(cities, { fields: [properties.cityId], references: [cities.id] }),
  propertyType: one(propertyTypes, {
    fields: [properties.propertyTypeId],
    references: [propertyTypes.id],
  }),
  cancellationPolicy: one(cancellationPolicies, {
    fields: [properties.cancellationPolicyId],
    references: [cancellationPolicies.id],
  }),
  images: many(propertyImages),
  units: many(units),
}));

export const unitsRelations = relations(units, ({ one, many }) => ({
  property: one(properties, { fields: [units.propertyId], references: [properties.id] }),
  currency: one(currencies, { fields: [units.currencyId], references: [currencies.id] }),
  amenities: many(unitAmenities),
}));

/**
 * Inverse sides, required by Drizzle.
 *
 * A `many()` without its matching `one()` throws at QUERY time, not compile time —
 * see `schema/relations.test.ts`, which now runs every relation to keep this class
 * of bug from shipping again.
 */
export const propertyImagesRelations = relations(propertyImages, ({ one }) => ({
  property: one(properties, {
    fields: [propertyImages.propertyId],
    references: [properties.id],
  }),
}));

export const unitAmenitiesRelations = relations(unitAmenities, ({ one }) => ({
  unit: one(units, { fields: [unitAmenities.unitId], references: [units.id] }),
  amenity: one(amenities, {
    fields: [unitAmenities.amenityId],
    references: [amenities.id],
  }),
}));
