import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { foreignId, primaryId, timestamps } from './_shared.js';
import { currencies } from './geo.js';
import { payoutAccountStatus, payoutStatus } from './enums.js';
import { users } from './identity.js';

/**
 * Where SAFRA's OWN revenue is collected (Bashar, 2026-09-05).
 *
 * ## Why this is not a row in `partner_payout_accounts`
 *
 * Two reasons, and the second is the one that matters. The table's `partner_id` is `NOT NULL` and
 * every query in the platform scopes by it, so a SAFRA row would either need a nullable owner —
 * making «whose account is this» a question every one of those queries has to start asking — or a
 * sentinel partner, which is a lie in a table other code trusts.
 *
 * The second: **the two must be impossible to confuse.** A partner payout paying into SAFRA's
 * account, or SAFRA's revenue landing in a partner's, is the worst outcome this feature has. A
 * separate table makes that a type error rather than a filter somebody forgot — `partner_payouts`
 * cannot reference a row here, and `safra_payouts` cannot reference one there.
 *
 * ## Everything else mirrors the partner table deliberately
 *
 * Encrypted number, last four in clear, the same `pending → verified` lifecycle with the same
 * `pending` column default so a row arriving by a route nobody has written yet is unusable until a
 * human looks at it. A destination for money is a destination for money; the rules that protect a
 * partner's are the rules that protect SAFRA's.
 */
export const safraPayoutAccounts = pgTable(
  'safra_payout_accounts',
  {
    id: primaryId(),
    /** A name a finance officer recognises: «الحساب التشغيلي», «حساب العمولات». */
    label: text('label').notNull(),
    /** "bank_transfer" | "sham_cash" | "cash_office" — the same rails a partner uses. */
    method: text('method').notNull(),
    accountHolder: text('account_holder').notNull(),
    /** AES-256-GCM ciphertext. Never logged, never returned by a list endpoint. */
    accountNumberEncrypted: text('account_number_encrypted').notNull(),
    /** Last four in clear, so a reader can confirm an account without decrypting one. */
    accountNumberLast4: text('account_number_last4').notNull(),
    bankName: text('bank_name'),
    swiftCode: text('swift_code'),
    currencyId: foreignId('currency_id')
      .notNull()
      .references(() => currencies.id),
    /**
     * The one a payout uses unless told otherwise.
     *
     * «Allow future support for multiple SAFRA payout accounts if required, while keeping one
     * active default destination» — so several may exist and exactly one may be the default. The
     * uniqueness is enforced by a partial index below rather than by the service, because a second
     * default is a state no code should be able to produce.
     */
    isDefault: boolean('is_default').notNull().default(false),
    /**
     * Whether it may receive money at all.
     *
     * Distinct from `status`: a verified account can be taken out of service without being
     * un-verified, and re-activated later without a second verification. Deactivating is an
     * operational act; un-verifying would be a statement about the account's authenticity.
     */
    isActive: boolean('is_active').notNull().default(true),
    /**
     * `pending` by DEFAULT, exactly as the partner table defaults it, and for the same reason: a
     * row inserted by a script, an import or a route written later is unusable until verified.
     */
    status: payoutAccountStatus('status').notNull().default('pending'),
    createdByUserId: foreignId('created_by_user_id').references(() => users.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedByUserId: foreignId('verified_by_user_id').references(() => users.id),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectedByUserId: foreignId('rejected_by_user_id').references(() => users.id),
    rejectionReason: text('rejection_reason'),
    ...timestamps,
  },
  (t) => [
    /**
     * At most ONE default among the live rows.
     *
     * A partial unique index rather than a service check: two concurrent writes both reading «no
     * default yet» and both setting one is a race a check cannot close, and the failure — two
     * defaults, a payout picking whichever the planner returned first — is silent and about money.
     */
    uniqueIndex('safra_payout_accounts_default_idx')
      .on(t.isDefault)
      .where(sql`is_default AND deleted_at IS NULL`),
  ],
);

/**
 * One transfer of SAFRA's own revenue out of the platform.
 *
 * ## What it settles
 *
 * Commission, the customer fee and advertising revenue accrue as CREDITS to
 * `safra_commission_partner`, `safra_commission_customer` and `ad_revenue`. Nothing debited them,
 * so the books said what SAFRA had EARNED and nothing about what it had COLLECTED. A payout debits
 * each of those for the amount accrued in its period and credits `safra_payout` for the total, in
 * one balanced entry group this row points at.
 *
 * ## Periods may not overlap
 *
 * That is what makes «covered» unambiguous without a join table of every ledger entry. Two payouts
 * over the same dates would settle the same revenue twice, and the ledger would balance while the
 * money left twice — the quietest possible accounting failure. Enforced in the service and stated
 * here because the constraint is the design.
 *
 * ## Denominated in SYP
 *
 * Revenue arrives in five currencies and `amount_syp` is what every entry already carries — the
 * settlement currency this platform's ledger is denominated in. A payout in "mixed" is not a thing
 * a bank can send.
 */
export const safraPayouts = pgTable(
  'safra_payouts',
  {
    id: primaryId(),
    reference: text('reference')
      .notNull()
      .unique()
      .default(sql`'SPY-' || reference_number(nextval('payout_reference_seq'))`),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    /** Each revenue stream, kept apart so the total is explicable rather than merely correct. */
    commissionPartnerAmount: numeric('commission_partner_amount', {
      precision: 18,
      scale: 2,
    })
      .notNull()
      .default('0'),
    commissionCustomerAmount: numeric('commission_customer_amount', {
      precision: 18,
      scale: 2,
    })
      .notNull()
      .default('0'),
    adRevenueAmount: numeric('ad_revenue_amount', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),
    /** The sum of the three, in SYP. What the bank actually moves. */
    netAmount: numeric('net_amount', { precision: 18, scale: 2 }).notNull(),
    /** The same lifecycle a partner payout follows, so one vocabulary covers both screens. */
    status: payoutStatus('status').notNull().default('pending_release'),
    payoutAccountId: foreignId('payout_account_id').references(
      () => safraPayoutAccounts.id,
    ),
    scheduledFor: date('scheduled_for'),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releasedByUserId: foreignId('released_by_user_id').references(() => users.id),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paidByUserId: foreignId('paid_by_user_id').references(() => users.id),
    /** The bank's own reference. What makes a line on a statement findable from here. */
    paidReference: text('paid_reference'),
    holdReason: text('hold_reason'),
    /** The ledger movement this payout discharged — the two reconcile in both directions. */
    entryGroupId: foreignId('entry_group_id'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    index('safra_payouts_period_idx').on(t.periodStart, t.periodEnd),
    index('safra_payouts_status_idx').on(t.status),
  ],
);
