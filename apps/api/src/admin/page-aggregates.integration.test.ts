import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { MessagingService } from './messaging.service.js';
import { RegistryService } from './registry.service.js';
import { SupportService } from '../support/support.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { Env } from '../config/env.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * The figures beside each row of العملاء, الرسائل and a customer's الدعم list are computed for the
 * PAGE, never for the whole table (go-live audit, 2026-10-06).
 *
 * ## The defect
 *
 * Each list joined a `GROUP BY` subquery to show one number per row: bookings per customer,
 * messages per thread. Postgres builds a grouped subquery in full before it joins it, so every view
 * of a ten-row page aggregated every booking, or every message, ever written. On safra_load
 * (5,087,045 bookings) page one of العملاء took 2.9 s and read 4.1 million buffers to print ten
 * booking counts; after the fix the counts cost ten index probes.
 *
 * ## Why the assertion is on the PLAN
 *
 * On the development database both shapes are fast, so a stopwatch cannot tell them apart and the
 * row values are the same either way. What differs is whether the scan of the big table is keyed:
 * a grouped subquery scans `bookings` or `messages` with no index condition at all, a per-row lookup
 * scans it by the row's id. So every statement the service issues is captured, explained, and every
 * scan of those two tables must carry an `Index Cond`. Sequential scans are switched off for the
 * transaction so a small table cannot make the planner prefer one and hide the shape.
 *
 * ## Watched to fail
 *
 * Each case was run against its service with the old `GROUP BY` join restored, and failed naming
 * the unkeyed scan; the value assertions beside them hold the figures to what they were.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** The tables that grow without bound and that these lists must only ever probe. */
const PROBED_ONLY = new Set(['bookings', 'messages']);

interface PlanNode {
  'Node Type'?: string;
  'Relation Name'?: string;
  'Index Cond'?: string;
  Plans?: PlanNode[];
}

describeIfDb(
  'per-row figures on the console lists are computed for the page only',
  () => {
    const harness = createRollbackDatabase(DATABASE_URL ?? '');
    const db: Database = harness.db;

    /** Every statement a service sends while `capturing` is set. */
    const captured: SQL[] = [];
    let capturing = false;

    const recording: Database = new Proxy(db, {
      get(target, property, receiver): unknown {
        if (property === 'execute') {
          return (query: SQL) => {
            if (capturing) captured.push(query);

            return target.execute(query);
          };
        }

        return Reflect.get(target, property, receiver);
      },
    });

    const registry = new RegistryService(recording);
    const messaging = new MessagingService(
      recording,
      new AuditService(db),
      {} as NotificationService,
      {
        APP_URL: 'http://localhost:3000',
        PARTNER_URL: 'http://localhost:3002',
      } as unknown as Env,
    );
    const support = new SupportService(recording);

    let customerReference = '';
    let customerProfileId = '';
    let customerUserId = '';

    const customer = (): AccessTokenClaims => ({
      sub: customerUserId,
      role: 'customer',
      permissions: [],
      locale: 'ar',
      customerProfileId,
    });

    /** A super admin: no city scope, so the console list reaches every thread. */
    const staff: AccessTokenClaims = {
      sub: '00000000-0000-7000-8000-000000000000',
      role: 'super_admin',
      permissions: [],
      locale: 'ar',
    };

    beforeEach(async () => {
      await harness.begin();
      await seed();
      captured.length = 0;
    });

    afterEach(() => harness.rollback());
    afterAll(() => harness.close());

    /** Runs `read` with its statements recorded, and returns what it returned. */
    async function recorded<T>(read: () => Promise<T>): Promise<T> {
      capturing = true;

      try {
        return await read();
      } finally {
        capturing = false;
      }
    }

    /** Every scan of a probed-only table in every captured statement, with whether it was keyed. */
    async function scansOfCaptured(): Promise<
      { table: string; node: string; keyed: boolean }[]
    > {
      expect(captured.length, 'the service issued statements to inspect').toBeGreaterThan(
        0,
      );

      await db.execute(sql`SET LOCAL enable_seqscan = off`);

      const scans: { table: string; node: string; keyed: boolean }[] = [];

      const keyed = (node: PlanNode): boolean =>
        node['Index Cond'] !== undefined || (node.Plans ?? []).some(keyed);

      const walk = (node: PlanNode): void => {
        const table = node['Relation Name'];

        if (table !== undefined && PROBED_ONLY.has(table)) {
          scans.push({ table, node: node['Node Type'] ?? '?', keyed: keyed(node) });
        }

        for (const child of node.Plans ?? []) walk(child);
      };

      for (const statement of captured) {
        const plan = await db.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
          sql`EXPLAIN (FORMAT JSON) ${statement}`,
        );
        const root = plan.rows[0]?.['QUERY PLAN'][0]?.Plan;

        expect(root, 'Postgres answered a plan').toBeTruthy();
        walk(root as PlanNode);
      }

      return scans;
    }

    it('العملاء counts each listed customer’s bookings by lookup, not over every booking', async () => {
      await seedBookings(3);

      const page = await recorded(() =>
        registry.customers({ limit: 10, page: 1, q: customerReference }),
      );

      /* The figures are unchanged by the rewrite: three bookings, and the latest one dates the row. */
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({ reference: customerReference, bookings: 3 });
      expect(page.total).toBe(1);

      const scans = await scansOfCaptured();

      expect(scans.map((scan) => scan.table)).toContain('bookings');
      expect(
        scans.filter((scan) => !scan.keyed),
        'an unkeyed scan of a whole table',
      ).toEqual([]);
    });

    it('الرسائل counts each listed thread’s messages by lookup, not over every message', async () => {
      const ticket = await support.open(
        customer(),
        'The heating does not come on in the evening.',
      );

      await db.execute(sql`
      INSERT INTO messages (conversation_id, sender_kind, body, internal)
      SELECT id, 'staff', 'Internal: called the host.', true FROM conversations
      WHERE reference = ${ticket.reference}
    `);

      const page = await recorded(() =>
        messaging.conversations({
          limit: 10,
          page: 1,
          q: ticket.reference,
          actor: staff,
        }),
      );

      /* The console counts the internal note too; that is what it has always shown staff. */
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        reference: ticket.reference,
        messageCount: 2,
      });
      expect(page.items[0]?.lastMessage).toBe(
        'The heating does not come on in the evening.',
      );

      const scans = await scansOfCaptured();

      expect(scans.map((scan) => scan.table)).toContain('messages');
      expect(
        scans.filter((scan) => !scan.keyed),
        'an unkeyed scan of a whole table',
      ).toEqual([]);
    });

    it('a customer’s own ticket list counts by lookup, and still leaves internal notes out', async () => {
      const ticket = await support.open(customer(), 'Can I change the dates of my stay?');

      await db.execute(sql`
      INSERT INTO messages (conversation_id, sender_kind, body, internal)
      SELECT id, 'staff', 'Internal: repeat asker.', true FROM conversations
      WHERE reference = ${ticket.reference}
    `);

      const list = await recorded(() => support.list(customer(), { limit: 10 }));

      expect(
        list.items.find((item) => item.reference === ticket.reference),
      ).toMatchObject({
        messageCount: 1,
      });

      const scans = await scansOfCaptured();

      expect(scans.map((scan) => scan.table)).toContain('messages');
      expect(
        scans.filter((scan) => !scan.keyed),
        'an unkeyed scan of a whole table',
      ).toEqual([]);
    });

    it('opening one ticket counts its messages by lookup', async () => {
      const ticket = await support.open(customer(), 'Is breakfast included?');

      const thread = await recorded(() => support.thread(customer(), ticket.reference));

      expect(thread.messageCount).toBe(1);

      const scans = await scansOfCaptured();

      expect(scans.map((scan) => scan.table)).toContain('messages');
      expect(
        scans.filter((scan) => !scan.keyed),
        'an unkeyed scan of a whole table',
      ).toEqual([]);
    });

    async function seed(): Promise<void> {
      const made = await db.execute<{
        id: string;
        reference: string;
        user_id: string;
      }>(sql`
      WITH cu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('agg-c-' || gen_random_uuid() || '@safra.test', '+963900000081',
                'customer', 'active', 'ar')
        RETURNING id
      )
      INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest, preferred_locale)
      SELECT cu.id, 'نزيل الصفحة', 'agg-c-' || gen_random_uuid() || '@safra.test',
             '+963900000081', false, 'ar'
      FROM cu RETURNING id, reference, user_id
    `);

      const row = made.rows[0];

      if (!row) throw new Error('Seed produced no customer.');

      customerProfileId = row.id;
      customerReference = row.reference;
      customerUserId = row.user_id;
    }

    /** `n` bookings against the seeded customer, on a property this test makes for the purpose. */
    async function seedBookings(n: number): Promise<void> {
      await db.execute(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('agg-p-' || gen_random_uuid() || '@safra.test', '+963900000082', 'partner', 'active')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Aggregate Test', 'شريك الصفحة', ref.city_id, 'x',
               '+963900000082', 'agg-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'aggregate-test-' || gen_random_uuid(), 'عقار الصفحة', 'Page', 'Page', 'x',
               'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 4, '100.00', ref.currency_id
        FROM pr, ref RETURNING id
      )
      INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                            check_in, check_out, guests_adults, status,
                            base_amount, customer_fee_value, customer_fee_amount,
                            partner_commission_rate, partner_commission_amount,
                            total_amount, partner_payable_amount, currency_id,
                            fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
      SELECT ${customerProfileId}::uuid, un.id, pr.id, pr.partner_id, ref.city_id,
             /* A different arrival per booking: the unit has an exclusion constraint on its dates. */
             current_date + (1600 + g.n * 3), current_date + (1602 + g.n * 3), 2,
             'confirmed'::booking_status,
             '100.00', '9.00', '9.00', '0.0700', '7.00', '109.00', '93.00',
             ref.currency_id, '13000.00000000', '1417000.00', '{"code":"flex"}'::jsonb
      FROM generate_series(1, ${n}) AS g(n), un, pr, ref
    `);
    }
  },
);
