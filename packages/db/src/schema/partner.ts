import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { foreignId, money, notDeleted, primaryId, timestamps } from './_shared.js';
import {
  partnerApplicationStatus,
  partnerTier,
  payoutStatus,
  verificationStatus,
  violationKind,
} from './enums.js';
import { cities, currencies } from './geo.js';
import { users } from './identity.js';
// `partner_payout_items` links a payout to the bookings it covers.
import { bookings } from './booking.js';

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

/**
 * A request to become a partner — the step BEFORE there is a partner (Bashar, 2026-08-19).
 *
 * ## Why this is not a `partners` row in some early status
 *
 * A `partners` row is a business SAFRA has a relationship with: it owns listings, it is paid, it
 * is screened against sanctions lists, and it hangs off a `users` row with partner permissions.
 * An application is none of those. It is somebody who filled in a form and may never be heard
 * from again, and the flow Bashar described puts a phone call and an acceptance between the two.
 *
 * Modelling it as a pending partner would mean every query that means "our partners" — the payout
 * sweep, the sanctions re-screen, the tier recomputation, the admin registry — would have to
 * remember to exclude applicants, and the one that forgot would be the bug. The types say it
 * instead: an application has no `user_id`, because there is no account yet.
 *
 * ## What it holds
 *
 * What the applicant typed, and what SAFRA did about it. `partner_id` is written when the request
 * is accepted, so the request keeps a pointer to what it became and the audit trail runs from a
 * form on the public site to a verified business without a gap.
 *
 * ## `submitted_by_user_id` is the account, and it is not optional in practice
 *
 * Applying requires a session (Bashar, 2026-08-19), so every row written since carries the
 * account that filed it — which is the account acceptance converts. The column stays NULLABLE
 * because rows written before that rule exist, and `accept` refuses those rather than guessing
 * which account they meant.
 *
 * `email` is still stored: it is the account's address AT THE TIME OF APPLYING, and a request
 * should say where SAFRA wrote rather than where the account's address has since moved to.
 */
export const partnerApplications = pgTable(
  'partner_applications',
  {
    id: primaryId(),
    reference: text('reference')
      .notNull()
      .unique()
      .default(
        sql`'PRQ-' || reference_number(nextval('partner_application_reference_seq'))`,
      ),
    status: partnerApplicationStatus('status').notNull().default('submitted'),

    /**
     * The account the applicant was signed into, if any.
     *
     * Recorded because it is the ONE case where the email address is already proven: a signed-in
     * customer applying is telling us about an account we can see. Most applicants are strangers
     * and this is null.
     */
    submittedByUserId: foreignId('submitted_by_user_id').references(() => users.id),

    /* ── What they told us ── */
    contactName: text('contact_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    partnerTypeId: foreignId('partner_type_id')
      .notNull()
      .references(() => partnerTypes.id),
    cityId: foreignId('city_id')
      .notNull()
      .references(() => cities.id),
    address: text('address').notNull(),
    /** How many properties they say they have. A sizing hint for the call, never a promise. */
    propertyCount: integer('property_count'),
    website: text('website'),
    /** Anything else they want the reviewer to know. */
    message: text('message'),
    /** Which language to write back in. The acknowledgement and the invitation both use it. */
    preferredLocale: text('preferred_locale').notNull().default('ar'),

    /* ── What we did about it ── */
    contactedAt: timestamp('contacted_at', { withTimezone: true }),
    contactedByUserId: foreignId('contacted_by_user_id').references(() => users.id),
    contactNotes: text('contact_notes'),

    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedByUserId: foreignId('decided_by_user_id').references(() => users.id),
    decisionNotes: text('decision_notes'),

    /** What the request became. Written on acceptance, null forever otherwise. */
    partnerId: foreignId('partner_id').references(() => partners.id),

    ...timestamps,
  },
  (t) => [
    /** The queue: open requests, oldest first. */
    index('partner_applications_status_idx').on(t.status, t.createdAt),
    /*
      The registry's default order is indexed in `migrations/post/0007_registry_order_indexes.sql`,
      as raw SQL rather than here.

      Drizzle's `.desc()` emits `DESC NULLS LAST`; PostgreSQL's plain `ORDER BY … DESC` means
      `NULLS FIRST`. The orderings therefore do not match and the index cannot remove the sort —
      measured, 2026-08-20: with the DSL-built index the plan stayed a sequential scan at 765
      buffers, and the same index written with PostgreSQL's own defaults turned it into an index
      scan at 27. Written where the ordering can be stated exactly.
    */
    /**
     * ONE open request per address.
     *
     * Partial, so a rejected applicant can apply again after fixing whatever was wrong — which
     * is a real thing that happens and should not need a staff member to clear a row first.
     */
    uniqueIndex('partner_applications_open_email_unique')
      .on(sql`lower(${t.email})`)
      .where(sql`status IN ('submitted', 'contacted') AND deleted_at IS NULL`),
  ],
);

export const partners = pgTable(
  'partners',
  {
    id: primaryId(),
    reference: text('reference')
      .notNull()
      .unique()
      .default(sql`'PAR-' || reference_number(nextval('partner_reference_seq'))`),
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
 * The signed commercial contract between SAFRA and a partner (design handoff §8.1).
 *
 * ## Why this is not a `partner_documents` row
 *
 * `partner_documents` holds what the PARTNER submits to be verified — an ID, a commercial
 * register, an ownership proof — and each one carries a verification decision. A contract is
 * the opposite direction: SAFRA drafts it, both sides sign it, and it governs the commercial
 * relationship. It has an expiry that drives a renewal reminder, a kind that changes what it
 * supersedes, and no "approve/reject" because nobody reviews SAFRA's own contract.
 *
 * Forcing both into one table would mean a `status` column meaning two different things.
 *
 * ## Superseded, never replaced
 *
 * The design's action is "استبدال" — replace. That inserts a NEW row and marks the previous one
 * superseded; the file is never overwritten. Which terms were in force on the day of a
 * disputed booking is a question that gets asked, and an in-place replacement destroys the
 * only record that can answer it.
 */
export const partnerContractKind = pgEnum('partner_contract_kind', [
  /** عقد شراكة أساسي — the base partnership agreement. */
  'base',
  /** ملحق تعديل عمولة — an annex changing the commission. */
  'commission_annex',
  /** تجديد سنوي — an annual renewal. */
  'renewal',
]);

export const partnerContractStatus = pgEnum('partner_contract_status', [
  'awaiting_partner_signature',
  'active',
  'superseded',
  'terminated',
]);

export const partnerContracts = pgTable(
  'partner_contracts',
  {
    id: primaryId(),
    partnerId: foreignId('partner_id')
      .notNull()
      .references(() => partners.id),
    kind: partnerContractKind('kind').notNull(),
    status: partnerContractStatus('status')
      .notNull()
      .default('awaiting_partner_signature'),

    /** Object-storage key, same abstraction as partner documents. PDF only, ≤ 10MB. */
    fileKey: text('file_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull().default('application/pdf'),
    sizeBytes: integer('size_bytes').notNull(),

    /** Always a staff member: a partner cannot upload SAFRA's contract. */
    uploadedByUserId: foreignId('uploaded_by_user_id')
      .notNull()
      .references(() => users.id),

    signedAt: timestamp('signed_at', { withTimezone: true }),
    /** Drives the design's "ينتهي خلال 41 يوماً" warning. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Which row replaced this one, when it was superseded. */
    supersededByContractId: foreignId('superseded_by_contract_id'),

    ...timestamps,
  },
  (t) => [
    index('partner_contracts_partner_idx').on(t.partnerId, t.status),
    /** The renewal sweep: active contracts by expiry. */
    index('partner_contracts_expiry_idx').on(t.status, t.expiresAt),
  ],
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

/**
 * The INVERSE side of each `many()` above.
 *
 * Drizzle needs both halves declared: `many()` alone says a partner has documents
 * but not which column joins them, so a relational query fails at runtime with
 * "not enough information to infer relation". These were missing, which meant
 * `GET /admin/partners/pending` — the §8.1 verification queue — returned a 500 on
 * every call from the day it shipped. Nothing caught it because nothing called it:
 * the endpoint had no consumer until the admin console was built, and a queue that
 * is never opened cannot be seen to be broken.
 */
export const partnerDocumentsRelations = relations(partnerDocuments, ({ one }) => ({
  partner: one(partners, {
    fields: [partnerDocuments.partnerId],
    references: [partners.id],
  }),
}));

export const partnerPayoutAccountsRelations = relations(
  partnerPayoutAccounts,
  ({ one }) => ({
    partner: one(partners, {
      fields: [partnerPayoutAccounts.partnerId],
      references: [partners.id],
    }),
  }),
);

export const partnerViolationsRelations = relations(partnerViolations, ({ one }) => ({
  partner: one(partners, {
    fields: [partnerViolations.partnerId],
    references: [partners.id],
  }),
}));

/**
 * A partner payout — a real transfer, or SAFRA's committed intent to make one.
 *
 * ## Why this exists rather than a sum over bookings
 *
 * `bookings.partner_payable_amount` is an OBLIGATION per booking. Summing it answers "what does
 * SAFRA owe this partner", which is a ledger question the ledger already answers through the
 * `partner_payable` account. It does NOT answer "what has SAFRA sent them, and when" — and the
 * design handoff's §7.1 line, *"تحويل مستحقات 1,240$ مجدول يوم الخميس"*, is the second question.
 *
 * Presenting the first as if it were the second, on the dashboard of the person owed the money, is
 * the failure mode this table exists to prevent. The console's الدفع screen already refused to do
 * it (it renders `payoutsMissing` rather than deriving a figure); this is the other half of that
 * decision, and the two must not disagree about whether a payout ledger exists.
 *
 * ## The money identity
 *
 * `net_amount = gross_amount - fine_amount`, enforced by a CHECK. `gross_amount` is the sum of the
 * items' payables at the moment they were attached, NOT a live recomputation — a payout is
 * evidence of what was decided, and a booking amended afterwards must not silently restate a
 * transfer that already happened.
 *
 * ## Where it meets the ledger
 *
 * Only on payment. Reaching `paid` posts one balanced movement — DEBIT `partner_payable`, CREDIT
 * `partner_payout` — and stores its `entry_group_id` here, so a payout row and the books can be
 * reconciled in either direction. Nothing is posted at accrual or release: intending to pay
 * somebody is not a movement of money.
 */
export const partnerPayouts = pgTable(
  'partner_payouts',
  {
    id: primaryId(),
    reference: text('reference')
      .notNull()
      .unique()
      .default(sql`'PYT-' || reference_number(nextval('payout_reference_seq'))`),
    partnerId: foreignId('partner_id')
      .notNull()
      .references(() => partners.id),
    currencyId: foreignId('currency_id')
      .notNull()
      .references(() => currencies.id),

    /** The accrual window this payout covers. Inclusive start, inclusive end. */
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),

    /** Sum of the attached items, frozen at attachment. See the note above. */
    grossAmount: money('gross_amount').notNull().default('0'),
    /** §6.4 fines and other deductions withheld from this transfer. */
    fineAmount: money('fine_amount').notNull().default('0'),
    netAmount: money('net_amount').notNull().default('0'),

    status: payoutStatus('status').notNull().default('accruing'),

    /**
     * Which account the money goes to, captured when the payout is RELEASED.
     *
     * Pinned rather than read live: a partner who changes their bank details after a transfer was
     * sent must not make the record say it went somewhere it did not.
     */
    payoutAccountId: foreignId('payout_account_id').references(
      () => partnerPayoutAccounts.id,
    ),

    /** The handoff's "مجدول يوم الخميس". Set on release, never before. */
    scheduledFor: date('scheduled_for'),

    releasedAt: timestamp('released_at', { withTimezone: true }),
    releasedByUserId: foreignId('released_by_user_id').references(() => users.id),

    paidAt: timestamp('paid_at', { withTimezone: true }),
    paidByUserId: foreignId('paid_by_user_id').references(() => users.id),
    /** The bank's own reference, so a partner's question can be answered against their statement. */
    paidReference: text('paid_reference'),

    /** Why it is frozen. Required whenever status is `on_hold` — see the CHECK. */
    holdReason: text('hold_reason'),

    /** The balanced movement posted when this was paid. Null until then. */
    entryGroupId: foreignId('entry_group_id'),

    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    /**
     * One open period per partner per currency.
     *
     * Two `accruing` payouts would race for the same bookings and each would report a total that
     * was true of neither. Partial, so the closed history is unconstrained.
     */
    uniqueIndex('partner_payouts_one_accruing')
      .on(t.partnerId, t.currencyId)
      .where(sql`status = 'accruing' AND deleted_at IS NULL`),
    index('partner_payouts_partner_idx').on(t.partnerId, t.createdAt),
    index('partner_payouts_status_idx').on(t.status, t.scheduledFor),
  ],
);

/**
 * Which bookings a payout covers — the reconciliation record.
 *
 * A partner asking "what is this $1,240 for" is answered from here, and a booking asking "have I
 * been paid out" is answered by whether a row exists. Both are questions somebody eventually asks
 * about money, so the link is stored rather than recomputed from dates.
 *
 * `amount` is the payable as it stood when the booking was attached, for the same reason the
 * payout's total is frozen: a later amendment must not restate a completed transfer.
 */
export const partnerPayoutItems = pgTable(
  'partner_payout_items',
  {
    id: primaryId(),
    payoutId: foreignId('payout_id')
      .notNull()
      .references(() => partnerPayouts.id),
    bookingId: foreignId('booking_id')
      .notNull()
      .references(() => bookings.id),
    amount: money('amount').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * A booking is paid out at most ONCE.
     *
     * This is the constraint that makes double-payment impossible rather than merely unlikely, and
     * it is a database guarantee because the alternative is trusting every future code path that
     * touches accrual. Cancelling a payout deletes its items, which returns those bookings to
     * accrual — the payout row itself survives with its amounts, so the event stays on record.
     */
    uniqueIndex('partner_payout_items_booking_unique').on(t.bookingId),
    index('partner_payout_items_payout_idx').on(t.payoutId),
  ],
);
