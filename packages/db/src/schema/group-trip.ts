/*
      No cover image in this version, and the column is absent rather than nullable-and-unused.
      A photograph here needs the variant pipeline `property_images` runs: `mediaUrl` builds its
      URL from the widths actually RENDERED, so a bare object key asks for a variant nobody made.
      A column nothing can fill reads as coverage and changes nothing — the shape `catalogue.ts`
      refuses for `partner_types.capabilities`. It arrives with the pipeline, together.
    */
import { relations } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { foreignId, money, notDeleted, primaryId, timestamps } from './_shared.js';
import { groupTripStatus } from './enums.js';
import { cities, currencies } from './geo.js';

/**
 * جروبات — trips SAFRA puts together and announces (Bashar, 2026-09-27, built 2026-09-28).
 *
 * ## Authored by staff, and only by staff
 *
 * Bashar's words: *«only the admin can create a group trip for this»*. That is the whole shape, and
 * it is why there is no partner column and no customer one: a group trip is SAFRA's own offer, not
 * a listing somebody submits. The authorization follows from the model rather than from a check —
 * there is no partner-reachable route because there is no partner-shaped write.
 *
 * ## An announcement, not a booking
 *
 * This version publishes a trip and routes interest to the support inbox that already exists. It
 * deliberately carries no seats-sold, no payment and no cancellation ladder, because the booking
 * engine books a UNIT with a quantity and a group trip is a different object — bolting it onto that
 * path is weeks of work for a demand nobody has evidenced yet. `seats` and `priceFrom` are things
 * a reader is TOLD, not things the platform reconciles.
 *
 * When it does become bookable, this table gains the booking side; nothing here has to be undone.
 *
 * ## One destination city
 *
 * A trip that visits four towns names the one it is ABOUT. The alternative — a join table of stops
 * — buys a richer itinerary and costs a screen to maintain it, and the itinerary a reader actually
 * wants is prose. The city is a foreign key rather than a free string so a trip can be found from
 * the city page it belongs to, which is the link that earns the column.
 *
 * ## No property is referenced, deliberately
 *
 * The standing rule is that no exact property location is published before a booking is confirmed.
 * Nothing here points at a property, so the rule has nothing to bite on: a trip names a CITY, which
 * is public on every listing already. If a future version attaches properties, that is the moment
 * to decide what a group page may show about them — not now, by accident.
 */
export const groupTrips = pgTable(
  'group_trips',
  {
    id: primaryId(),
    /** Stable key for the public URL: `/groups/coastal-syria-spring`. */
    slug: text('slug').notNull(),
    /** What the trip is ABOUT. A multi-city itinerary names its principal destination. */
    cityId: foreignId('city_id')
      .notNull()
      .references(() => cities.id),
    titleAr: text('title_ar').notNull(),
    titleEn: text('title_en'),
    titleDe: text('title_de'),
    /** One line, for the card. Distinct from the description so a card is not a truncated essay. */
    summaryAr: text('summary_ar').notNull(),
    summaryEn: text('summary_en'),
    summaryDe: text('summary_de'),
    /** The body, including whatever itinerary the trip has. Prose, because prose is what is read. */
    descriptionAr: text('description_ar').notNull(),
    descriptionEn: text('description_en'),
    descriptionDe: text('description_de'),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    /**
     * «من 250$» — an indication, not a quote, and NEVER rendered without its currency.
     *
     * Nullable as a pair with `currencyId`: a trip may honestly say «السعر عند الطلب», and a price
     * with no currency is the shape `.claude/CLAUDE.md` forbids outright — SYP and USD differ by
     * four orders of magnitude, so a bare number is not a smaller version of the right answer.
     */
    priceFrom: money('price_from'),
    currencyId: foreignId('currency_id').references(() => currencies.id),
    /** How many people are going, when that is known. A statement, not an inventory. */
    seats: integer('seats'),
    /*
      The cover photograph (Bashar, 2026-09-29: «I do not want Group Trips displayed as text-only
      content»). The previous version of this file refused a column that nothing could fill —
      «a column nothing can fill reads as coverage and changes nothing» — and said it would arrive
      WITH the pipeline. It has: the console uploads through `ImageService.process`, the same call
      the city hero uses, so these are filled by the same code that fills `city_images`.

      ONE cover, as columns rather than a `group_trip_images` table: a trip announces itself with a
      single picture, and a table would make «two covers» representable and then need a rule to
      forbid it. `variantWidths` is what was actually RENDERED — `mediaUrl` picks from it, so a
      guess here is a 404 — and `width`/`height` let a card reserve its box before the bytes land,
      which is the difference between a list that loads and a list that jumps.

      A CHECK in `0084_group_trip_cover.sql` refuses metadata without a key, so «alt text for a
      photograph that is not there» is unrepresentable rather than merely discouraged.
    */
    coverFileKey: text('cover_file_key'),
    coverVariantWidths: integer('cover_variant_widths').array().notNull().default([]),
    coverWidth: integer('cover_width'),
    coverHeight: integer('cover_height'),
    coverAltAr: text('cover_alt_ar'),
    coverAltEn: text('cover_alt_en'),
    coverAltDe: text('cover_alt_de'),
    status: groupTripStatus('status').notNull().default('draft'),
    /** When it first became public, so «newly announced» is answerable later. */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('group_trips_slug_unique').on(t.slug).where(notDeleted),
    /* The public read: published trips, soonest first. */
    index('group_trips_public_idx').on(t.status, t.startsOn),
    index('group_trips_city_idx').on(t.cityId),
  ],
);

export const groupTripsRelations = relations(groupTrips, ({ one }) => ({
  city: one(cities, { fields: [groupTrips.cityId], references: [cities.id] }),
  currency: one(currencies, {
    fields: [groupTrips.currencyId],
    references: [currencies.id],
  }),
}));
