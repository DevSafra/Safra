import { relations, sql } from 'drizzle-orm';
import { bigint, index, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { foreignId, money, primaryId, timestamps } from './_shared.js';
import { adStatus } from './enums.js';
import { cities, currencies } from './geo.js';
import { users } from './identity.js';

/** What kind of business is advertising. Restaurants and activities are the launch set. */
export const advertiserKind = pgEnum('advertiser_kind', [
  'restaurant',
  'activity',
  'shop',
  'transport',
  'other',
]);

/** How a campaign is billed. The design shows only "شهري"; the column allows the others. */
export const adBillingPeriod = pgEnum('ad_billing_period', [
  'weekly',
  'monthly',
  'quarterly',
]);

/**
 * A business paying to appear to SAFRA's customers (design handoff §8, الإعلانات).
 *
 * Separate from `partners` on purpose, and this is the important distinction: a partner sells
 * accommodation through SAFRA and is bound by the P-002 verification and the 7% commission. An
 * advertiser is a restaurant that pays for placement and sells nothing through the platform.
 * Conflating them would put a shawarma shop into the partner verification queue and give it a
 * commission rate.
 */
export const advertisers = pgTable(
  'advertisers',
  {
    id: primaryId(),
    reference: text('reference')
      .notNull()
      .unique()
      .default(sql`'ADV-' || reference_number(nextval('advertiser_reference_seq'))`),
    name: text('name').notNull(),
    kind: advertiserKind('kind').notNull(),
    cityId: foreignId('city_id')
      .notNull()
      .references(() => cities.id),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    ...timestamps,
  },
  (t) => [index('advertisers_city_idx').on(t.cityId)],
);

/**
 * One paid placement (design handoff §8).
 *
 * ## The rules that live with the data
 *
 * The handoff states three, and each one shapes a column:
 *
 * - **City-targeted.** `cityId` is required, because an ad is shown by the city of the
 *   customer's booking, never platform-wide.
 * - **Never mixed into search ranking.** There is deliberately no `priority`, `boost` or
 *   `rank` column. Adding one is how "always labelled إعلان شريك, never mixed with organic
 *   results" quietly stops being true.
 * - **At most one WhatsApp message.** Enforced by the notification log rather than a counter
 *   here: `notifications` already records what was sent to whom about what.
 *
 * ## Impressions and clicks are counters, not an event log
 *
 * `bigint`, incremented in place. An events table would be the correct shape for attribution
 * analysis and the wrong one here: this screen needs a total, the volume is per-pageview, and a
 * row per impression would be the largest table in the database inside a month for a number
 * nobody queries at row level.
 */
export const adCampaigns = pgTable(
  'ad_campaigns',
  {
    id: primaryId(),
    /** `ADS-000031`, as the design shows. Its sequence was provisioned in migrations/pre. */
    reference: text('reference')
      .notNull()
      .unique()
      .default(sql`'ADS-' || reference_number(nextval('ad_reference_seq'))`),

    advertiserId: foreignId('advertiser_id')
      .notNull()
      .references(() => advertisers.id),
    /**
     * The city the campaign TARGETS.
     *
     * Distinct from the advertiser's own city: a Damascus tour operator may legitimately
     * advertise to customers booking in Aleppo.
     */
    cityId: foreignId('city_id')
      .notNull()
      .references(() => cities.id),

    status: adStatus('status').notNull().default('draft'),
    billingPeriod: adBillingPeriod('billing_period').notNull().default('monthly'),
    priceAmount: money('price_amount'),
    priceCurrencyId: foreignId('price_currency_id').references(() => currencies.id),

    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),

    impressions: bigint('impressions', { mode: 'number' }).notNull().default(0),
    clicks: bigint('clicks', { mode: 'number' }).notNull().default(0),

    createdByUserId: foreignId('created_by_user_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('ad_campaigns_status_idx').on(t.status, t.endsAt),
    index('ad_campaigns_city_idx').on(t.cityId, t.status),
    index('ad_campaigns_advertiser_idx').on(t.advertiserId),
  ],
);

export const advertisersRelations = relations(advertisers, ({ one, many }) => ({
  city: one(cities, { fields: [advertisers.cityId], references: [cities.id] }),
  campaigns: many(adCampaigns),
}));

export const adCampaignsRelations = relations(adCampaigns, ({ one }) => ({
  advertiser: one(advertisers, {
    fields: [adCampaigns.advertiserId],
    references: [advertisers.id],
  }),
  city: one(cities, { fields: [adCampaigns.cityId], references: [cities.id] }),
}));
