import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { BookingAccessService } from '../bookings/booking-access.service.js';
import { BookingActionsService } from '../bookings/booking-actions.service.js';
import { BookingCreationService } from '../bookings/booking-creation.service.js';
import { PricingService } from '../bookings/pricing.service.js';
import { SlaService } from '../bookings/sla.service.js';
import { VoucherService } from '../bookings/voucher.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { codeOf } from '../common/errors/app-error.js';
import { unlockedJobRuns } from '../common/jobs/job-run.testing.js';
import type { Env } from '../config/env.js';
import type { FxRateService } from '../fx/fx-rate.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { CouponService } from './coupon.service.js';
import { releaseCouponRedemptions } from './coupon-release.js';

/**
 * A coupon is used once the booking is PAID, and given back when it never is (Bashar, 2026-10-06:
 * «Give it back»).
 *
 * ## The defect
 *
 * The redemption is written when the booking is CREATED, under the coupon's lock, and nothing ever
 * removed it. So a customer who applied a once-per-customer code, reached the payment screen and
 * closed the tab had spent the code: EC-001 expired the booking and returned their wallet hold,
 * and the next attempt at the same stay answered «you have already used this coupon». The same
 * after a cancellation before payment. And every abandoned checkout also counted against the
 * campaign's `max_redemptions`, so a campaign could run out without selling its last stay.
 *
 * ## The opposite controls
 *
 * A paid booking still consumes the code, and a booking cancelled AFTER payment keeps it spent.
 * Without those, «release everything» would pass every assertion here.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a coupon on a booking that is never paid', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const fx = {
    rateToSyp: () => Promise.resolve('13000.00000000'),
    decimalsOf: () => Promise.resolve(2),
  } as unknown as FxRateService;

  const notifications = {
    notify: () => Promise.resolve(),
  } as unknown as NotificationService;

  const settings = new SettingsService(db);
  const coupons = new CouponService(db);
  const audit = new AuditService(db);

  const creation = new BookingCreationService(
    db,
    new PricingService(db, settings, fx),
    settings,
    audit,
    new BookingAccessService(db),
    coupons,
  );

  const actions = new BookingActionsService(
    db,
    settings,
    audit,
    new LedgerService(db),
    new WalletService(db, fx),
    notifications,
    {
      PARTNER_URL: 'https://partner.test',
      APP_URL: 'https://safra.test',
    } as unknown as Env,
    new VoucherService(db),
    new FieldEncryptionService({
      FIELD_ENCRYPTION_KEY: 'c'.repeat(64),
    } as unknown as Env),
  );

  const sla = new SlaService(
    db,
    {
      resolveOrFallback: (_k: string, fallback: string) => Promise.resolve(fallback),
    } as never,
    new LedgerService(db),
    new WalletService(db, fx),
    unlockedJobRuns(db),
    notifications,
    { APP_URL: 'https://safra.test', PARTNER_URL: 'https://partner.test' } as never,
  );

  let unitId = '';
  let couponId = '';
  let code = '';
  let email = '';

  beforeEach(async () => {
    await harness.begin();
    ({ unitId, couponId, code } = await aCouponedListing());
    email = `release-${Math.floor(Math.random() * 1e9)}@example.test`;
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /** A stay for this guest, on a week of its own so two attempts never overlap. */
  const book = (week: number, address = email) =>
    creation.createDraft(
      {
        unitId,
        checkIn: dayFromNow(900 + week * 7),
        checkOut: dayFromNow(902 + week * 7),
        adults: 2,
        guest: { fullName: 'ضيف الكوبون', email: address, phone: '+963900000131' },
        couponCode: code,
      },
      undefined,
      {},
    );

  const redemptions = async () =>
    (
      await db.execute<{ rows: string; counted: number }>(sql`
        SELECT (SELECT count(*)::text FROM coupon_redemptions WHERE coupon_id = ${couponId}::uuid)
                 AS rows,
               (SELECT redemptions_count FROM coupons WHERE id = ${couponId}::uuid) AS counted
      `)
    ).rows[0];

  /**
   * EC-001. Watched to fail against the old code: the second attempt answered
   * `coupon.customer_limit` with the first booking already cancelled.
   */
  it('gives the code back when the checkout is abandoned and the booking expires', async () => {
    const abandoned = await book(0);

    await db.execute(sql`
      UPDATE bookings SET confirmation_deadline_at = now() - INTERVAL '1 minute'
      WHERE reference = ${abandoned.reference}
    `);
    await sla.sweep();

    expect(await redemptions(), 'the expired booking still holds the code').toStrictEqual(
      {
        rows: '0',
        counted: 0,
      },
    );

    const again = await book(1);

    expect(again.price.totalAmount, 'the retry is discounted').not.toBe(
      again.price.baseAmount,
    );
  });

  /** A sweep that runs every minute must not give the same coupon back sixty times. */
  it('gives it back once, however often the release runs', async () => {
    const abandoned = await book(0);
    const id = await idOf(abandoned.reference);

    /* A second, independent redemption that must survive the release of the first. */
    await book(1, `other-${email}`);

    expect((await redemptions())?.counted).toBe(2);

    await releaseCouponRedemptions(db, [id]);
    await releaseCouponRedemptions(db, [id]);

    expect(await redemptions()).toStrictEqual({ rows: '1', counted: 1 });
  });

  it('gives the code back when the customer cancels before paying', async () => {
    const draft = await book(0);

    await actions.cancel(draft.reference, 'changed my mind', 'customer', undefined);

    expect(await redemptions()).toStrictEqual({ rows: '0', counted: 0 });
    await expect(book(1)).resolves.toBeDefined();
  });

  /** The control. Paying is what spends a once-per-customer code. */
  it('keeps the code spent once the booking is paid', async () => {
    const draft = await book(0);

    await actions.markPaid(draft.reference, undefined);

    const refusal = await book(1).catch((error: unknown) => error);

    expect(codeOf(refusal)).toBe(ERROR.COUPON_CUSTOMER_LIMIT);
    expect(await redemptions()).toStrictEqual({ rows: '1', counted: 1 });
  });

  /** And paying then cancelling does not hand it back: it was used. */
  it('keeps the code spent when a paid booking is cancelled', async () => {
    const draft = await book(0);

    await actions.markPaid(draft.reference, undefined);
    await actions.cancel(draft.reference, 'partner overbooked', 'staff', undefined);

    expect(await redemptions()).toStrictEqual({ rows: '1', counted: 1 });
  });

  /**
   * Guest checkout finds a profile by the EXACT address, so a profile written as `Guest@x` (before
   * the boundary lowercased addresses, or by any path that does not) and today's `guest@x` were two
   * customers, and a once-per-customer code could be spent once by each. The limit now also keys
   * on the normalised address. Watched to fail against the old code: the second booking was
   * discounted.
   */
  it('refuses a guest re-using the code under the same address on a second profile', async () => {
    const legacy = await book(0, `  ${email.toUpperCase()} `);

    await actions.markPaid(legacy.reference, undefined);

    const refusal = await book(1, email).catch((error: unknown) => error);

    expect(codeOf(refusal)).toBe(ERROR.COUPON_CUSTOMER_LIMIT);
  });

  /** The control: another address is another customer, and the code is theirs to use. */
  it('still lets a different address use it', async () => {
    const draft = await book(0);

    await actions.markPaid(draft.reference, undefined);

    await expect(book(1, `someone-else-${email}`)).resolves.toBeDefined();
  });

  async function idOf(reference: string): Promise<string> {
    const rows = await db.execute<{ id: string }>(sql`
      SELECT id FROM bookings WHERE reference = ${reference}
    `);

    return rows.rows[0]?.id ?? '';
  }

  function dayFromNow(days: number): string {
    const day = new Date();

    day.setUTCDate(day.getUTCDate() + days);

    return day.toISOString().slice(0, 10);
  }

  /** A published unit, and a once-per-customer 10% coupon its partner has accepted. */
  async function aCouponedListing(): Promise<{
    unitId: string;
    couponId: string;
    code: string;
  }> {
    const made = await db.execute<{ unit: string; coupon: string; code: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('rel-' || gen_random_uuid() || '@safra.test', '+963900000130', 'partner', 'active')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Coupon Release', 'كوبون', ref.city_id, 'x',
               '+963900000130', 'rel-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'coupon-release-' || gen_random_uuid(), 'عقار', 'Prop', 'Prop', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id, is_active)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 4, '100.00', ref.currency_id, true
        FROM pr, ref
        RETURNING id
      ), co AS (
        INSERT INTO coupons (code, type, value_kind, value, starts_at, ends_at,
                             max_redemptions_per_customer, is_active)
        VALUES ('REL' || floor(random() * 1e9)::text, 'seasonal', 'percent', '10',
                now() - interval '1 day', now() + interval '30 days', 1, true)
        RETURNING id, code
      ), cpa AS (
        INSERT INTO coupon_partners (coupon_id, partner_id, status, decided_at)
        SELECT co.id, pr.partner_id, 'accepted', now() FROM co, pr
        RETURNING coupon_id
      )
      SELECT un.id AS unit, co.id AS coupon, co.code FROM un, co, cpa
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Fixture produced no row.');

    return { unitId: row.unit, couponId: row.coupon, code: row.code };
  }
});
