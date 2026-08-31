import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { foreignId, money, primaryId, timestamps } from './_shared.js';
import { adStatus, imageStatus } from './enums.js';
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

    /**
     * The creative — what a customer actually SEES.
     *
     * Three columns, exactly as `properties` stores a name, because the customer app serves ar, en
     * and de and an ad is operator-written text a person reads. One stored string for three
     * readers is the failure `content.ts` documents at length; requiring all three is what stops a
     * German customer being shown Arabic.
     */
    headlineAr: text('headline_ar').notNull(),
    headlineEn: text('headline_en').notNull(),
    headlineDe: text('headline_de').notNull(),

    /**
     * The sentence under the headline — what the ad SAYS, beyond what it is called.
     *
     * Three columns like the headline, because the customer app serves ar, en and de and this is
     * operator-written text a person reads. NULLABLE, unlike the headline: a headline is what
     * makes a card an advertisement and an ad without one is not renderable, while a description
     * is an elaboration the card is complete without — the same reasoning the creative image is
     * optional under. Every campaign written before 2026-08-31 has none, and none of them is
     * broken by that.
     */
    descriptionAr: text('description_ar'),
    descriptionEn: text('description_en'),
    descriptionDe: text('description_de'),

    /**
     * Where a click goes. Validated to http/https at the boundary.
     *
     * The click endpoint redirects to THIS column and never to anything in the request, so the
     * redirect target is always something staff typed and never something a caller supplied — an
     * open redirect on SAFRA's own domain would be a phishing primitive with our name on it.
     */
    targetUrl: text('target_url').notNull(),

    /*
      The CREATIVE image, through the same pipeline every other picture on the platform uses.

      It was one nullable `image_path` — a free-text column nothing wrote and nothing read, and the
      reason the customer app rendered text only: an `<img>` built from a path nobody validates
      means the first thing to write that column decides what SAFRA's pages fetch.

      These five are `property_images`' shape, minus the gallery: a campaign has ONE creative, so
      there is no sort order, no cover and no second row. Everything else is identical because it is
      literally the same code — `ImageService.inspect` refuses anything that is not a photograph by
      its magic bytes, the worker re-encodes it (which destroys polyglot files and strips EXIF), and
      `variant_widths` records what was actually produced because the pipeline never upscales.

      `image_status` is the field that says whether the URLs resolve yet. A campaign with no image
      is still a complete ad — a headline and an advertiser name — so all five are nullable.
    */
    /*
      `image_path` is KEPT and unused (2026-08-27).

      It was the free-text column this replaces, and nothing ever wrote it — measured at 0 of 21
      campaigns the day the pipeline was built. Dropping it would make `db:generate` ask whether the
      new `image_file_key` is a RENAME of it, which is a question a non-interactive run cannot
      answer, and answering it wrong would rewrite the column rather than add one.
      
      So it stays, deprecated, with nothing reading it. The same trade `TABLE_SECTIONS` records for
      `staffScope`: a dead name is cheaper than a migration that has to be got right by eye.
    */
    imagePath: text('image_path'),

    imageFileKey: text('image_file_key'),
    imageWidth: integer('image_width'),
    imageHeight: integer('image_height'),
    imageVariantWidths: integer('image_variant_widths').array(),
    imageStatus: imageStatus('image_status'),
    /** The uploaded bytes, parked until the worker has re-encoded them. Cleared when it has. */
    imageOriginalKey: text('image_original_key'),
    imageFailureCode: text('image_failure_code'),

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

/** Where an ad invoice stands. `void` is for one cancelled before it was ever paid. */
export const adInvoiceStatus = pgEnum('ad_invoice_status', ['due', 'paid', 'void']);

/**
 * What an advertiser owes for one billing period of one campaign.
 *
 * ## Why this is its own table rather than a `payments` row
 *
 * `payments.booking_id` is NOT NULL: that table records money for a STAY, and it cannot express a
 * payment that is not for one. The same wall stopped gift-card purchases going through it. An ad is
 * billed per PERIOD rather than per transaction, so an invoice is the shape it actually has.
 *
 * ## One row per period, issued when the campaign is created
 *
 * A campaign has a fixed window, so every period it will ever be billed for is known the moment it
 * exists — there is nothing for a scheduled job to discover later. Issuing them up front means an
 * advertiser can be shown what the campaign will cost in total before it runs, and a period nobody
 * can generate is a period nobody forgets to.
 *
 * ## Money is recorded when it is PAID, not when it is billed
 *
 * A `due` invoice is a claim, not revenue: SAFRA has not been paid and may never be. The ledger
 * pair (`ad_payment` ↔ `ad_revenue`) is posted at the moment finance marks it paid, in the same
 * transaction, so the books never carry revenue for a campaign that was never funded.
 */
export const adInvoices = pgTable(
  'ad_invoices',
  {
    id: primaryId(),
    reference: text('reference')
      .notNull()
      .unique()
      .default(sql`'ADI-' || reference_number(nextval('ad_invoice_reference_seq'))`),
    campaignId: foreignId('campaign_id')
      .notNull()
      .references(() => adCampaigns.id),

    /** Inclusive start, exclusive end — the same shape a coupon window uses. */
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),

    amount: money('amount').notNull(),
    currencyId: foreignId('currency_id')
      .notNull()
      .references(() => currencies.id),

    status: adInvoiceStatus('status').notNull().default('due'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paidByUserId: foreignId('paid_by_user_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    /*
      One invoice per campaign per period.

      Issuing is idempotent because of this: a retried creation, or a repair script run twice,
      cannot bill an advertiser for the same month twice. That is the whole reason it is a UNIQUE
      index rather than a plain one.
    */
    uniqueIndex('ad_invoices_period_unique').on(t.campaignId, t.periodStart),
    index('ad_invoices_status_idx').on(t.status, t.periodStart),
  ],
);
