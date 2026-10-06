import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import type { AccessTokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { codeOf } from '../common/errors/app-error.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { silentDisputeNotifier } from './dispute-notifier.testing.js';
import { DisputeService } from './dispute.service.js';
import { interleaved } from '../common/testing/interleaved.testing.js';

/**
 * Two operators acting on one dispute at the same moment.
 *
 * ## The defect
 *
 * `close` read the status OUTSIDE its transaction, with no lock, and its UPDATE matched on the id
 * alone. Two operators pressing «حلّ» together both passed the «already closed» check and both
 * ran the transaction, so the customer was compensated TWICE: two wallet credits, two ledger
 * groups. `acknowledge` had the same shape, and landing just after a close it set the dispute back
 * to `investigating`, which is UNRESOLVED, which re-froze the partner's released payout.
 *
 * ## How the race is staged
 *
 * The rollback harness has one connection, so `Promise.all` would serialise and prove nothing. The
 * other operator's whole action is run at the exact moment this one opens its transaction (after
 * its read, before its write), which is the window the defect lives in. Deterministic, and it
 * failed against the old code every time.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const STAFF = (sub: string): AccessTokenClaims =>
  ({
    sub,
    role: 'operations_manager',
    permissions: ['dispute.manage'],
  }) as unknown as AccessTokenClaims;

describeIfDb('a dispute two operators settle at once', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const serviceOver = (handle: Database) =>
    new DisputeService(
      handle,
      new AuditService(handle),
      new WalletService(handle, new FxRateService(handle, new AuditService(handle))),
      new LedgerService(handle),
      new FxRateService(handle, new AuditService(handle)),
      silentDisputeNotifier(),
    );

  let bookingReference = '';
  let staffId = '';
  let profileId = '';
  let disputeReference = '';

  beforeEach(async () => {
    await harness.begin();
    await seed();
    disputeReference = (
      await serviceOver(db).openForBooking(STAFF(staffId), {
        bookingReference,
        kind: 'not_as_described',
        title: 'الغرفة لا تطابق الوصف',
        description: 'أفاد العميل بأن الغرفة أصغر بكثير مما ظهر في الصور المنشورة.',
      })
    ).reference;
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const resolve = (service: DisputeService) =>
    service.close(STAFF(staffId), disputeReference, {
      outcome: 'resolved',
      resolution: 'عُوّض العميل عن الفارق في الوصف.',
      compensationAmount: '10.00',
      compensationCurrency: 'USD',
    });

  const statusNow = async () =>
    (
      await db.execute<{ status: string }>(sql`
        SELECT status::text AS status FROM disputes WHERE reference = ${disputeReference}
      `)
    ).rows[0]?.status;

  const credits = async () =>
    Number(
      (
        await db.execute<{ n: string }>(sql`
          SELECT count(*)::text AS n
          FROM wallet_transactions t JOIN wallets w ON w.id = t.wallet_id
          WHERE w.customer_profile_id = ${profileId}::uuid AND t.direction = 'credit'
        `)
      ).rows[0]?.n ?? 0,
    );

  /** Watched to fail against the old code: two credits, and no conflict for the second operator. */
  it('pays the compensation once when two operators close it together', async () => {
    const refusal = await resolve(
      serviceOver(interleaved(db, () => resolve(serviceOver(db)))),
    ).catch((error: unknown) => error);

    expect(codeOf(refusal), 'the second operator is told it is already closed').toBe(
      ERROR.DISPUTE_ALREADY_CLOSED,
    );
    expect(await credits(), 'the customer compensated twice').toBe(1);
    expect(await statusNow()).toBe('resolved');
  });

  /** Watched to fail against the old code: the dispute went back to `investigating`. */
  it('does not reopen a dispute closed while the operator was taking it', async () => {
    const refusal = await serviceOver(interleaved(db, () => resolve(serviceOver(db))))
      .acknowledge(STAFF(staffId), disputeReference)
      .catch((error: unknown) => error);

    expect(codeOf(refusal)).toBe(ERROR.DISPUTE_ALREADY_CLOSED);
    expect(await statusNow(), 'reopened, and the payout frozen again').toBe('resolved');
  });

  /** Two operators taking it at once: one takes it, the other is told it is taken. */
  it('lets one of two operators take it, quietly', async () => {
    const other = () => serviceOver(db).acknowledge(STAFF(staffId), disputeReference);

    const second = await serviceOver(interleaved(db, other)).acknowledge(
      STAFF(staffId),
      disputeReference,
    );

    expect(second).toStrictEqual({ acknowledged: false });
    expect(await statusNow()).toBe('investigating');
    expect(
      Number(
        (
          await db.execute<{ n: string }>(sql`
            SELECT count(*)::text AS n FROM audit_log
            WHERE action = 'dispute.acknowledged'
              AND subject_id = (SELECT id FROM disputes WHERE reference = ${disputeReference})
          `)
        ).rows[0]?.n,
      ),
      'one audit row for one acknowledgement',
    ).toBe(1);
  });

  /**
   * Staff raising the same complaint twice at once: the «one live dispute per kind» check ran
   * before the transaction, so both passed it. Watched to fail with the in-transaction check
   * disabled: two live disputes of one kind.
   */
  it('opens one dispute when two operators raise the same reason at once', async () => {
    const raise = (service: DisputeService) =>
      service.openForBooking(STAFF(staffId), {
        bookingReference,
        kind: 'property_unavailable',
        title: 'الشقة كانت مغلقة',
        description: 'وصل العميل فوجد الشقة مغلقة ولم يرد أحد على الهاتف.',
      });

    const refusal = await raise(
      serviceOver(interleaved(db, () => raise(serviceOver(db)))),
    ).catch((error: unknown) => error);

    expect(codeOf(refusal)).toBe(ERROR.DISPUTE_ALREADY_OPEN);

    const live = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM disputes d JOIN bookings b ON b.id = d.booking_id
      WHERE b.reference = ${bookingReference} AND d.kind = 'property_unavailable'
        AND d.status IN ('open', 'investigating')
    `);

    expect(live.rows[0]?.n).toBe('1');
  });

  /** The controls: alone, each action still does its whole job. */
  it('closes with compensation when nobody else is acting', async () => {
    await resolve(serviceOver(db));

    expect(await credits()).toBe(1);
    expect(await statusNow()).toBe('resolved');
  });

  it('acknowledges when nobody else is acting', async () => {
    expect(
      await serviceOver(db).acknowledge(STAFF(staffId), disputeReference),
    ).toStrictEqual({
      acknowledged: true,
    });
    expect(await statusNow()).toBe('investigating');
  });

  /** A checked-in stay, a USD wallet, and the operator who will settle the complaint. */
  async function seed(): Promise<void> {
    const made = await db.execute<{
      reference: string;
      staff: string;
      profile: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS usd_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), st AS (
        INSERT INTO users (full_name, email, phone, role, status)
        VALUES ('مدير العمليات', 'drc-s-' || gen_random_uuid() || '@safra.test',
                '+963900000151', 'operations_manager', 'active')
        RETURNING id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('drc-c-' || gen_random_uuid() || '@safra.test', '+963900000152', 'customer',
                'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('drc-p-' || gen_random_uuid() || '@safra.test', '+963900000153', 'partner',
                'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'نزيل النزاع', 'drc-c-' || gen_random_uuid() || '@safra.test',
               '+963900000152', false
        FROM cu RETURNING id
      ), fx_usd AS (
        /* Pinned, so the ledger's SYP leg does not depend on whatever rate a database holds. */
        INSERT INTO fx_rates (base_currency_id, quote_currency_id, rate, effective_from, source)
        SELECT ref.usd_id, (SELECT id FROM currencies WHERE code = 'SYP'),
               '13000.00000000', now() - interval '1 hour', 'test'
        FROM ref
        RETURNING id
      ), wa AS (
        INSERT INTO wallets (customer_profile_id, currency_id, balance)
        SELECT cp.id, ref.usd_id, '0.00' FROM cp, ref
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Dispute Race', 'نزاع', ref.city_id, 'x',
               '+963900000153', 'drc-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'dispute-race-' || gen_random_uuid(), 'عقار النزاع', 'Race', 'Race', 'x',
               'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 2, '100.00', ref.usd_id FROM pr, ref
        RETURNING id
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at, checked_in_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 640, current_date + 643, 2, 'checked_in'::booking_status,
               now(), now(),
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.usd_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, un, pr, ref
        RETURNING reference, customer_profile_id
      )
      SELECT bk.reference, st.id AS staff, bk.customer_profile_id AS profile
      FROM bk, st, wa, fx_usd
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    bookingReference = row.reference;
    staffId = row.staff;
    profileId = row.profile;
  }
});
