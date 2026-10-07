import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import type { AccessTokenClaims } from '../auth/token.service.js';
import type { CurrencyTotal } from './currency-totals.js';
import { DashboardService } from './dashboard.service.js';
import { FinanceService } from './finance.service.js';
import { ReportsService } from './reports.service.js';

/**
 * Every money figure the console prints is scoped like the list beside it, and is per currency.
 *
 * ## The two defects
 *
 * 1. **Country-wide money for a city-scoped member.** The dashboard's «إيرادات اليوم» and الدفع's
 *    captured, refunded and fines cards read every row in the country, while the counters and the
 *    table beside them were narrowed to the member's cities.
 * 2. **Currencies added together.** Each card summed amounts in whatever currency each row was
 *    written in and printed the result with ONE code. SYP and USD differ by four orders of
 *    magnitude, so a single pound-denominated row made the dollar figure meaningless.
 *
 * ## How it isolates itself on a shared database
 *
 * Three fresh cities: HERE and THERE carry the fixtures, and EMPTY carries nothing. A member scoped
 * to EMPTY still sees platform-level rows (a ledger leg with no booking has no city, and
 * `scopeFilter` allows it), so that reading is the BASELINE and every assertion is a difference
 * from it. With the scope missing, «HERE minus baseline» picks up THERE and the rest of the
 * country; with currencies summed, the SYP fixture lands inside the dollar figure. Both are
 * watched to fail.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('console money: scoped, and one figure per currency', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const dashboard = new DashboardService(db);
  const finance = new FinanceService(db);
  const reports = new ReportsService(db);

  let here = '';
  let there = '';
  let empty = '';

  const scopedTo = (cityIds: string[]): AccessTokenClaims =>
    ({
      sub: randomUUID(),
      role: 'finance_officer',
      permissions: [],
      scope: { kind: 'cities', cityIds, outside: 'none' },
    }) as unknown as AccessTokenClaims;

  /** One currency's figure out of a per-currency list, as a number; absent is zero. */
  const of = (totals: readonly CurrencyTotal[], currency: string): number =>
    Number(totals.find((total) => total.currency === currency)?.amount ?? 0);

  /** `a − b`, rounded to the cent, so a difference of amounts compares exactly. */
  const minus = (a: number, b: number): number => Math.round((a - b) * 100) / 100;

  async function city(slug: string): Promise<string> {
    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO cities (country_id, slug, name_ar, name_en, name_de, timezone)
      VALUES ((SELECT id FROM countries WHERE deleted_at IS NULL ORDER BY code LIMIT 1),
              ${slug}, 'مدينة', 'City', 'Stadt', 'Asia/Damascus')
      RETURNING id::text
    `);

    return made.rows[0]?.id ?? '';
  }

  /**
   * A partner, and one booking PAID TODAY in `currency`, with its ledger capture, in `cityId`.
   *
   * Revenue is commission + fee; the capture is the booking total; the payable is what remains.
   */
  async function paidBooking(
    cityId: string,
    currency: 'USD' | 'SYP',
    money: { commission: string; fee: string; total: string; payable: string },
  ): Promise<{ bookingId: string; partnerId: string }> {
    const made = await db.execute<{ booking_id: string; partner_id: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM currencies WHERE code = ${currency}) AS currency_id,
               (SELECT id FROM property_types LIMIT 1)              AS type_id,
               (SELECT id FROM partner_types LIMIT 1)               AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)       AS policy_id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES (${`money-p-${randomUUID()}@safra.test`}, '+963900000180', 'partner', 'active')
        RETURNING id, email
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Money Test', 'شريك المال', ${cityId}::uuid, 'x',
               '+963900000180', pu.email, 'approved'
        FROM pu, ref RETURNING id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ${cityId}::uuid, ref.type_id, ref.policy_id,
               ${`money-${randomUUID()}`}, 'عقار', 'Property', 'Objekt', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 4, ${money.total}, ref.currency_id FROM pr, ref
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (full_name, email, phone, is_guest)
        VALUES ('نزيل', ${`money-c-${randomUUID()}@safra.test`}, '+963900000181', true)
        RETURNING id
      )
      INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                            check_in, check_out, guests_adults, status,
                            base_amount, customer_fee_value, customer_fee_amount,
                            partner_commission_rate, partner_commission_amount,
                            total_amount, partner_payable_amount, currency_id,
                            fx_rate_to_syp, total_syp, cancellation_policy_snapshot, paid_at)
      SELECT cp.id, un.id, pr.id, pr.partner_id, ${cityId}::uuid,
             current_date + 2600, current_date + 2602, 2, 'confirmed'::booking_status,
             ${money.total}, ${money.fee}, ${money.fee}, '0.0700', ${money.commission},
             ${money.total}, ${money.payable}, ref.currency_id,
             '1.00000000', ${money.total}, '{"code":"flex"}'::jsonb, now()
      FROM cp, un, pr, ref
      RETURNING id::text AS booking_id, partner_id::text
    `);

    const row = made.rows[0];

    if (!row) throw new Error('the money fixture built no booking');

    /* The capture, as a balanced pair: the trigger checks every group. */
    await db.execute(sql`
      WITH g AS (SELECT gen_random_uuid() AS id),
           c AS (SELECT id FROM currencies WHERE code = ${currency})
      INSERT INTO ledger_entries (entry_group_id, account, direction, amount, currency_id,
                                  fx_rate_to_syp, amount_syp, booking_id, description)
      SELECT g.id, leg.account::ledger_account, leg.direction::ledger_direction,
             ${money.total}::numeric, c.id, 1, ${money.total}::numeric,
             ${row.booking_id}::uuid, 'console money fixture'
      FROM g, c, (VALUES ('customer_payment', 'credit'), ('partner_payable', 'debit'))
             AS leg(account, direction)
    `);

    return { bookingId: row.booking_id, partnerId: row.partner_id };
  }

  /** A fine imposed and collected this month, with no booking: it scopes by the partner's city. */
  async function collectedFine(partnerId: string, currency: string, value: string) {
    await db.execute(sql`
      INSERT INTO partner_violations (partner_id, kind, occurrence_number, stage, score_penalty,
                                      fine_amount, fine_currency_id, fine_collected_amount,
                                      collected_at)
      VALUES (${partnerId}::uuid, 'stale_calendar', 1, 'fined', 0,
              ${value}, (SELECT id FROM currencies WHERE code = ${currency}), ${value}, now())
    `);
  }

  async function paidAdInvoice(cityId: string, currency: string, value: string) {
    await db.execute(sql`
      WITH adv AS (
        INSERT INTO advertisers (name, kind, city_id)
        VALUES ('معلن', 'restaurant', ${cityId}::uuid) RETURNING id
      ), camp AS (
        INSERT INTO ad_campaigns (advertiser_id, city_id, status, starts_at, ends_at,
                                  headline_ar, headline_en, headline_de, target_url)
        SELECT adv.id, ${cityId}::uuid, 'active', now() - interval '1 day',
               now() + interval '30 days', 'عنوان', 'Headline', 'Titel', 'https://example.test/x'
        FROM adv RETURNING id
      )
      INSERT INTO ad_invoices (campaign_id, period_start, period_end, amount, currency_id,
                               status, paid_at)
      SELECT camp.id, now() - interval '1 day', now() + interval '30 days', ${value},
             (SELECT id FROM currencies WHERE code = ${currency}), 'paid', now()
      FROM camp
    `);
  }

  beforeEach(async () => {
    await harness.begin();

    const tag = randomUUID().slice(0, 8);

    here = await city(`money-here-${tag}`);
    there = await city(`money-there-${tag}`);
    empty = await city(`money-empty-${tag}`);

    /* HERE: a dollar booking AND a pound booking, the pair a single sum would conflate. */
    const usd = await paidBooking(here, 'USD', {
      commission: '7.00',
      fee: '9.00',
      total: '109.00',
      payable: '93.00',
    });

    await paidBooking(here, 'SYP', {
      commission: '91000.00',
      fee: '0.00',
      total: '1300000.00',
      payable: '1209000.00',
    });
    await collectedFine(usd.partnerId, 'USD', '25.00');
    await paidAdInvoice(here, 'USD', '50.00');

    /* THERE: the same dollar shapes, which a member limited to HERE must not see. */
    const elsewhere = await paidBooking(there, 'USD', {
      commission: '70.00',
      fee: '90.00',
      total: '1090.00',
      payable: '930.00',
    });

    await collectedFine(elsewhere.partnerId, 'USD', '250.00');
    await paidAdInvoice(there, 'USD', '500.00');
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it('reports today’s revenue on the dashboard for the member’s cities, per currency', async () => {
    const base = (await dashboard.overview(scopedTo([empty]))).counters.revenue_today;
    const mine = (await dashboard.overview(scopedTo([here]))).counters.revenue_today;
    const both = (await dashboard.overview(scopedTo([here, there]))).counters
      .revenue_today;

    expect(
      minus(of(mine, 'USD'), of(base, 'USD')),
      'HERE in dollars, and not THERE',
    ).toBe(16);
    expect(
      minus(of(mine, 'SYP'), of(base, 'SYP')),
      'HERE in pounds, on its own line',
    ).toBe(91000);
    /* The opposite control: a member covering both cities sees both. */
    expect(minus(of(both, 'USD'), of(base, 'USD'))).toBe(176);
  });

  it('draws the week’s revenue for the member’s cities, one series per currency', async () => {
    const today = (
      series: readonly { currency: string; days: readonly { amount: string }[] }[],
      currency: string,
    ): number =>
      Number(series.find((one) => one.currency === currency)?.days.at(-1)?.amount ?? 0);

    const base = (await dashboard.overview(scopedTo([empty]))).revenue;
    const mine = (await dashboard.overview(scopedTo([here]))).revenue;

    expect(minus(today(mine, 'USD'), today(base, 'USD'))).toBe(16);
    expect(minus(today(mine, 'SYP'), today(base, 'SYP'))).toBe(91000);

    for (const one of mine) {
      expect(one.days, `${one.currency} carries all seven days`).toHaveLength(7);
    }
  });

  it('scopes every card on الدفع and keeps each currency apart', async () => {
    const base = await finance.counters(scopedTo([empty]));
    const mine = await finance.counters(scopedTo([here]));
    const both = await finance.counters(scopedTo([here, there]));

    const delta = (
      cards: Awaited<ReturnType<FinanceService['counters']>>,
      card: keyof Awaited<ReturnType<FinanceService['counters']>>,
      currency: string,
    ): number => minus(of(cards[card], currency), of(base[card], currency));

    expect(delta(mine, 'captured_today', 'USD'), 'captured').toBe(109);
    expect(delta(mine, 'captured_today', 'SYP'), 'captured, in pounds').toBe(1300000);
    expect(delta(mine, 'fines_collected_month', 'USD'), 'fines').toBe(25);
    expect(delta(mine, 'ad_revenue_month', 'USD'), 'advertising').toBe(50);
    expect(delta(mine, 'partner_payable_outstanding', 'USD'), 'payable').toBe(93);
    expect(delta(mine, 'partner_payable_outstanding', 'SYP'), 'payable, in pounds').toBe(
      1209000,
    );

    expect(delta(both, 'captured_today', 'USD')).toBe(1199);
    expect(delta(both, 'fines_collected_month', 'USD')).toBe(275);
    expect(delta(both, 'ad_revenue_month', 'USD')).toBe(550);
  });

  it('gives التقارير one revenue card per currency, scoped to the member’s cities', async () => {
    const card = (
      cards: Awaited<ReturnType<ReportsService['cards']>>,
      key: 'commission_revenue' | 'ad_revenue',
      currency: string,
    ): number =>
      Number(
        cards.find((one) => one.key === key && one.currency === currency)?.value ?? 0,
      );

    const base = await reports.cards(scopedTo([empty]));
    const mine = await reports.cards(scopedTo([here]));

    expect(
      minus(
        card(mine, 'commission_revenue', 'USD'),
        card(base, 'commission_revenue', 'USD'),
      ),
    ).toBe(16);
    expect(
      minus(
        card(mine, 'commission_revenue', 'SYP'),
        card(base, 'commission_revenue', 'SYP'),
      ),
    ).toBe(91000);
    expect(minus(card(mine, 'ad_revenue', 'USD'), card(base, 'ad_revenue', 'USD'))).toBe(
      50,
    );

    for (const one of mine) {
      expect(
        one.series,
        `${one.key} ${one.currency ?? ''} keeps all eight weeks`,
      ).toHaveLength(8);
    }

    /* A non-money card states no currency at all. */
    expect(mine.find((one) => one.key === 'occupancy')?.currency).toBeNull();
  });
});
