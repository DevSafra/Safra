import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { foreignId, money, notDeleted, primaryId, timestamps } from './_shared.js';
import { partnerTier, verificationStatus, violationKind } from './enums.js';
import { cities, currencies } from './geo.js';
import { users } from './identity.js';

/**
 * SRS §12: Van and car rental must be addable "without rebuilding the system".
 * Partner types are therefore rows, not an enum — adding Mobility is an INSERT.
 * `capabilities` declares which modules a type unlocks, so the app branches on
 * data rather than on a hardcoded list of type names.
 */
export const partnerTypes = pgTable('partner_types', {
  id: primaryId(),
  code: text('code').notNull().unique(), // accommodation | restaurant | activity | mobility
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  nameDe: text('name_de').notNull(),
  capabilities: jsonb('capabilities').$type<string[]>().notNull().default([]),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

export const partners = pgTable(
  'partners',
  {
    id: primaryId(),
    reference: text('reference')
      .notNull()
      .unique()
      .default(sql`'PAR-' || lpad(nextval('partner_reference_seq')::text, 6, '0')`),
    /** Owning login. Staff of a partner get their own users rows later. */
    userId: foreignId('user_id')
      .notNull()
      .references(() => users.id),
    partnerTypeId: foreignId('partner_type_id')
      .notNull()
      .references(() => partnerTypes.id),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    cityId: foreignId('city_id')
      .notNull()
      .references(() => cities.id),
    address: text('address').notNull(),
    latitude: text('latitude'),
    longitude: text('longitude'),
    phone: text('phone').notNull(),
    email: text('email').notNull(),

    /** SRS §8.1 — nothing publishes before SAFRA approves (principle P-002). */
    verification: verificationStatus('verification').notNull().default('pending'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedByUserId: foreignId('verified_by_user_id').references(() => users.id),

    /**
     * Sanctions screening. The general Syria sanctions programme was repealed in
     * 2025, but residual SDN designations and export controls survive it, so
     * onboarding must screen and record the result. See ADR 0002.
     */
    sanctionsScreenedAt: timestamp('sanctions_screened_at', { withTimezone: true }),
    sanctionsScreeningResult: jsonb('sanctions_screening_result'),

    /** SRS §8.5: internal score starts at 100 and drives "SAFRA recommends". */
    score: integer('score').notNull().default(100),
    tier: partnerTier('tier').notNull().default('new'),
    /** Rolling operational stats, recomputed by a worker — never by hand. */
    avgResponseMinutes: integer('avg_response_minutes'),
    cancellationCount: integer('cancellation_count').notNull().default(0),
    complaintCount: integer('complaint_count').notNull().default(0),

    contractSignedAt: timestamp('contract_signed_at', { withTimezone: true }),
    /** P-003: suspension, never deletion. */
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedReason: text('suspended_reason'),
    ...timestamps,
  },
  (t) => [
    index('partners_city_idx').on(t.cityId),
    index('partners_verification_idx').on(t.verification),
    // Powers the admin "unresponsive partners" and ranking queries (§9.2).
    index('partners_score_idx').on(t.score),
    uniqueIndex('partners_user_unique').on(t.userId).where(notDeleted),
  ],
);

/**
 * Bank/transfer details, split out because they are the most sensitive partner
 * data we hold. Encrypted at rest and readable only by Finance-role staff — SRS
 * §4.1 forbids exposing them to anyone whose role does not require them.
 */
export const partnerPayoutAccounts = pgTable(
  'partner_payout_accounts',
  {
    id: primaryId(),
    partnerId: foreignId('partner_id')
      .notNull()
      .references(() => partners.id),
    /** "bank_transfer" | "sham_cash" | "cash_office" — varies per country (§18). */
    method: text('method').notNull(),
    accountHolder: text('account_holder').notNull(),
    /** AES-256-GCM ciphertext. Never logged, never returned in list endpoints. */
    accountNumberEncrypted: text('account_number_encrypted').notNull(),
    /** Last 4 digits in clear, so staff can confirm an account without decrypting. */
    accountNumberLast4: text('account_number_last4').notNull(),
    bankName: text('bank_name'),
    swiftCode: text('swift_code'),
    currencyId: foreignId('currency_id')
      .notNull()
      .references(() => currencies.id),
    isPrimary: boolean('is_primary').notNull().default(false),
    ...timestamps,
  },
  (t) => [index('partner_payout_accounts_partner_idx').on(t.partnerId)],
);

/** SRS §8.1: ID, commercial register, ownership proof or management contract. */
export const partnerDocuments = pgTable(
  'partner_documents',
  {
    id: primaryId(),
    partnerId: foreignId('partner_id')
      .notNull()
      .references(() => partners.id),
    kind: text('kind').notNull(),
    /** Object-storage key. Files live in S3, never as bytes in Postgres. */
    fileKey: text('file_key').notNull(),
    fileName: text('file_name').notNull(),
    status: verificationStatus('status').notNull().default('pending'),
    reviewedByUserId: foreignId('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNotes: text('review_notes'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('partner_documents_partner_status_idx').on(t.partnerId, t.status)],
);

/**
 * SRS §6.4: missing the 2-hour window costs the partner a fine, the full amount of
 * which is credited to the customer's wallet on a first offence. Later offences
 * escalate, and the escalation ladder is configurable (see settings).
 */
export const partnerViolations = pgTable(
  'partner_violations',
  {
    id: primaryId(),
    partnerId: foreignId('partner_id')
      .notNull()
      .references(() => partners.id),
    /** Nullable: stale-calendar violations are not tied to one booking. */
    bookingId: foreignId('booking_id'),
    kind: violationKind('kind').notNull(),
    /** Which offence this is for that partner — drives the escalation ladder. */
    occurrenceNumber: integer('occurrence_number').notNull().default(1),
    fineAmount: money('fine_amount'),
    fineCurrencyId: foreignId('fine_currency_id').references(() => currencies.id),
    /** Portion credited to the customer vs retained by SAFRA (§6.4). */
    customerCompensationAmount: money('customer_compensation_amount'),
    scorePenalty: integer('score_penalty').notNull().default(0),
    collectedAt: timestamp('collected_at', { withTimezone: true }),
    waivedAt: timestamp('waived_at', { withTimezone: true }),
    waivedByUserId: foreignId('waived_by_user_id').references(() => users.id),
    waivedReason: text('waived_reason'),
    ...timestamps,
  },
  (t) => [
    index('partner_violations_partner_idx').on(t.partnerId, t.createdAt),
    index('partner_violations_booking_idx').on(t.bookingId),
  ],
);

export const partnersRelations = relations(partners, ({ one, many }) => ({
  user: one(users, { fields: [partners.userId], references: [users.id] }),
  partnerType: one(partnerTypes, {
    fields: [partners.partnerTypeId],
    references: [partnerTypes.id],
  }),
  city: one(cities, { fields: [partners.cityId], references: [cities.id] }),
  documents: many(partnerDocuments),
  payoutAccounts: many(partnerPayoutAccounts),
  violations: many(partnerViolations),
}));
