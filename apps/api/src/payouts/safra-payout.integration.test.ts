import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { SafraPayoutService } from './safra-payout.service.js';
import { codeOf } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import type { Env } from '../config/env.js';

/**
 * SAFRA's own treasury — destinations, transfers, and the books they move.
 *
 * ## What these hold
 *
 * The whole point of this feature is that SAFRA's revenue accrued as credits and **nothing ever
 * debited them**, so «what have we collected» had no answer. The assertions that matter are
 * therefore about the LEDGER rather than about the rows:
 *
 * 1. **Outstanding is derived.** `accrued − transferred`, straight from the entries, so a payout
 *    moves the summary without anything storing a balance.
 * 2. **Paying posts a BALANCED group** — one debit per contributing revenue stream, one credit to
 *    `safra_payout` — and the payout points at it.
 * 3. **Nothing is paid into an unverified or inactive destination**, checked at PAYMENT and not
 *    only when the payout was opened: those are days apart.
 * 4. **Periods may not overlap.** Two payouts over the same dates would settle the same revenue
 *    twice, the books would still balance, and the money would leave twice.
 */
/** A throwaway 32-byte key. These tests encrypt within one run and store nothing that outlives it. */
const TEST_ENV = { FIELD_ENCRYPTION_KEY: 'c'.repeat(64) } as unknown as Env;

const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('SafraPayoutService', () => {
  /*
    One snapshot for the whole test, because every figure here is platform-wide.

    `revenueSummary` sums the entire ledger, so a test that reads it, acts, and reads it again is
    comparing two moments in a database other suites are committing to in parallel — vitest runs
    files in threads and they all share one database. Under READ COMMITTED that showed up as
    "earning did not change: expected 1500977570 to be close to 1500561830", a difference produced
    by somebody else's booking rather than by anything this test did.

    REPEATABLE READ gives every statement in the transaction the same snapshot, so concurrent
    commits are invisible and the only thing that can move a figure is this test. The metrics suite
    uses the same harness setting for the same reason.
  */
  const harness = createRollbackDatabase(DATABASE_URL ?? '', 'repeatable read');
  let db: Database;
  let service: SafraPayoutService;
  let ledger: LedgerService;
  let actor: AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    ledger = new LedgerService(db);
    service = new SafraPayoutService(
      db,
      new AuditService(db),
      new FieldEncryptionService(TEST_ENV),
      ledger,
    );

    /* A real user id: `audit_log.actor_user_id` is a foreign key and a fabricated one rolls the write back. */
    const staff = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM users WHERE role = 'super_admin' AND deleted_at IS NULL LIMIT 1
    `);

    actor = {
      sub: staff.rows[0]?.id,
      role: 'super_admin',
    } as unknown as AccessTokenClaims;

    /*
      An empty transfer table, inside the rollback.

      Every test here opens a period near today, and a PAID transfer claims its period for ever —
      so the browser suite, which drives the real lifecycle against the same database, left rows
      that made nine of these fail with a period-overlap conflict. Nothing was wrong with the
      service: the suite silently depended on nobody having used the feature.

      Clearing inside the transaction is what makes them independent of each other AND of any other
      suite. It rolls back with everything else, so the real transfers are still there afterwards.
      Both tables, and the payouts first — safra_payouts references the accounts.
    */
    await db.execute(sql`DELETE FROM safra_payouts`);
    await db.execute(sql`DELETE FROM safra_payout_accounts`);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  const account = async (overrides: { label?: string } = {}) =>
    service.createAccount(actor, {
      label: overrides.label ?? 'الحساب التشغيلي',
      method: 'bank_transfer',
      accountHolder: 'SAFRA Travel LLC',
      accountNumber: 'SY12 3456 7890 1234',
      bankName: 'بنك بيمو السعودي الفرنسي',
      currency: 'SYP',
    });

  /** A period with revenue in it, taken from the ledger rather than guessed. */
  const periodWithRevenue = async () => {
    const rows = await db.execute<{ from: string; to: string }>(sql`
      SELECT min(created_at)::date::text AS from, max(created_at)::date::text AS to
      FROM ledger_entries
      WHERE account::text IN ('safra_commission_partner', 'safra_commission_customer', 'ad_revenue')
        AND direction = 'credit'
    `);

    return rows.rows[0]!;
  };

  // ── Destinations ──────────────────────────────────────────────────────────

  describe('destinations', () => {
    it('creates one, masked, and pending by default', async () => {
      const { id } = await account();
      const found = (await service.accounts()).find((one) => one.id === id);

      expect(found?.label).toBe('الحساب التشغيلي');
      expect(found?.last4, 'only the last four are readable').toBe('1234');
      expect(found?.status, 'unusable until a human verifies it').toBe('pending');
      expect(found?.isDefault, 'and it is not the default merely by existing').toBe(
        false,
      );
    });

    /**
     * The number never comes back, and the projection does not even read it.
     *
     * Asserted by walking every string in the row rather than by naming the field — the shape the
     * payout-account work settled on, because `not.toContain(number)` only ever protects the one
     * field it names and the next one added walks straight around it.
     */
    it('never returns the account number in any field', async () => {
      const { id } = await account();
      const found = (await service.accounts()).find((one) => one.id === id);

      const strings = Object.values(found ?? {})
        .filter((value): value is string => typeof value === 'string')
        .join(' ');

      expect(strings).not.toContain('SY12');
      expect(strings).not.toContain('34567890');
    });

    it('verifies one, and records who did it', async () => {
      const { id } = await account();

      await service.verifyAccount(actor, id);

      const found = (await service.accounts()).find((one) => one.id === id);

      expect(found?.status).toBe('verified');
      expect(found?.verifiedAt).toBeTruthy();
    });

    /**
     * At most ONE default, enforced by the database.
     *
     * A second default would make «where does SAFRA's money go» answered by whichever row the
     * planner returned first. The service clears the others inside the same transaction so the
     * operator gets what they asked for rather than a constraint violation.
     */
    it('moves the default rather than allowing two', async () => {
      const first = await account({ label: 'الأول' });
      const second = await account({ label: 'الثاني' });

      await service.updateAccount(actor, first.id, { isDefault: true });
      await service.updateAccount(actor, second.id, { isDefault: true });

      const accounts = await service.accounts();

      expect(accounts.filter((one) => one.isDefault)).toHaveLength(1);
      expect(accounts.find((one) => one.isDefault)?.id).toBe(second.id);
    });

    /* Rejecting takes it out of service AND clears the default: nothing may fall back to it. */
    it('clears the default when an account is rejected', async () => {
      const { id } = await account();

      await service.updateAccount(actor, id, { isDefault: true });
      await service.rejectAccount(actor, id, { reason: 'الحساب يخصّ جهة أخرى.' });

      const found = (await service.accounts()).find((one) => one.id === id);

      expect(found?.status).toBe('rejected');
      expect(found?.isDefault).toBe(false);
    });

    it('answers an id that is not there', async () => {
      expect(
        codeOf(
          await service
            .verifyAccount(actor, '00000000-0000-7000-8000-000000000000')
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.SAFRA_PAYOUT_ACCOUNT_NOT_FOUND);
    });
  });

  // ── Revenue ───────────────────────────────────────────────────────────────

  describe('the revenue summary', () => {
    it('reports accrued, transferred and the difference', async () => {
      const summary = await service.revenueSummary();

      expect(
        Number(summary.accrued),
        'the platform has earned something',
      ).toBeGreaterThan(0);
      expect(Number(summary.outstanding).toFixed(2)).toBe(
        (Number(summary.accrued) - Number(summary.transferred)).toFixed(2),
      );
    });

    /* Every stream is named, so a total is explicable rather than merely correct. */
    it('breaks the total down by revenue account', async () => {
      const summary = await service.revenueSummary();

      expect(summary.byAccount.map((one) => one.account).sort()).toStrictEqual([
        'ad_revenue',
        'safra_commission_customer',
        'safra_commission_partner',
      ]);
    });
  });

  /*
    Revenue that went back to the customer is not revenue.

    These assert against figures computed in SQL written INDEPENDENTLY of the service, rather than
    against constants: a hard-coded expectation would go stale the first time the fixture changed
    and would then be edited to match whatever the service happened to answer, which is a test that
    can never fail.
  */
  /*
    What a refund does to SAFRA's own revenue, and to what SAFRA owes the partner.

    Bashar's rule, in two decisions:

      - 2026-09-05: a booking refunded to its full stay price gives up its partner commission, and
        the SAFRA service fee keeps the behaviour it had.
      - 2026-09-07: a PARTIAL refund reduces the partner payable in proportion, because «SAFRA
        should not silently absorb refund costs while continuing to recognise the full partner
        earning and full commission as if no refund occurred».

    So three accounts are held to three different answers on the same event, and every test below
    names which one it is about. A test that checked one account would pass against a service that
    applied one rule to all three — which is exactly what the previous version did: it reversed the
    commission, left `partner_payable` standing, and looked correct.
  */
  describe('revenue that was refunded', () => {
    /** Accrued for one account, as the service reports it. */
    async function accruedOn(account: string): Promise<number> {
      const summary = await service.revenueSummary();

      return Number(
        summary.byAccount.find((one) => one.account === account)?.accrued ?? 0,
      );
    }

    /** What has been given back on one account for one booking, in the BOOKING's currency. */
    async function reversedOn(account: string, bookingId: string): Promise<number> {
      const rows = await db.execute<{ total: string }>(sql`
        SELECT coalesce(sum(e.amount), 0)::text AS total
          FROM ledger_entries e
         WHERE e.booking_id = ${bookingId}::uuid
           AND e.account = ${account}
           AND e.direction = 'debit'
      `);

      return Number(rows.rows[0]!.total);
    }

    /*
      A booking with a refund of a chosen share of its stay price — BUILT, never searched for.

      The historical backfill reversed every fully refunded booking in the database, so a search
      for an unreversed one now finds nothing and the test would SKIP: green, and covering
      precisely nothing. Building it also makes the share an input, which is what lets one helper
      serve the full case, the partial case and the second-refund case.
    */
    async function bookingRefunded(share: number) {
      const clean = await db.execute<{
        id: string;
        base: string;
        commission: string;
        payable: string;
        fx: string;
      }>(sql`
        SELECT b.id::text,
               b.base_amount::text AS base,
               b.fx_rate_to_syp::text AS fx,
               (SELECT sum(e.amount) FROM ledger_entries e
                 WHERE e.booking_id = b.id
                   AND e.account = 'safra_commission_partner'
                   AND e.direction = 'credit')::text AS commission,
               (SELECT sum(e.amount) FROM ledger_entries e
                 WHERE e.booking_id = b.id
                   AND e.account = 'partner_payable'
                   AND e.direction = 'credit')::text AS payable
          FROM bookings b
         WHERE b.base_amount > 0
           AND NOT EXISTS (SELECT 1 FROM refunds r
                            WHERE r.booking_id = b.id AND r.deleted_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM partner_payout_items i WHERE i.booking_id = b.id)
           AND EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id)
           AND EXISTS (SELECT 1 FROM ledger_entries e
                        WHERE e.booking_id = b.id
                          AND e.account = 'safra_commission_partner'
                          AND e.direction = 'credit')
           AND EXISTS (SELECT 1 FROM ledger_entries e
                        WHERE e.booking_id = b.id
                          AND e.account = 'partner_payable'
                          AND e.direction = 'credit')
         LIMIT 1
      `);

      const row = clean.rows[0];

      expect(row, 'a captured booking with no refund to build on').toBeDefined();

      await addRefund(row!.id, share);

      return row!;
    }

    /** One more completed refund for `share` of the stay price. */
    async function addRefund(bookingId: string, share: number): Promise<void> {
      await db.execute(sql`
        INSERT INTO refunds (payment_id, booking_id, amount, currency_id,
                             applied_refund_percent, reason, status, wallet_amount,
                             completed_at)
        SELECT p.id, b.id, round(b.base_amount * ${String(share)}::numeric, 2), b.currency_id,
               ${String(share * 100)}::numeric,
               'built by safra-payout.integration.test', 'completed', 0, now()
          FROM bookings b JOIN payments p ON p.booking_id = b.id
         WHERE b.id = ${bookingId}::uuid
         LIMIT 1
      `);
    }

    it('gives back the whole commission AND the whole payable on a booking refunded in full', async () => {
      const booking = await bookingRefunded(1);

      const before = await accruedOn('safra_commission_partner');
      const posted = await ledger.reverseForRefund(db, booking.id);

      expect(posted, 'it posted a group').not.toBeNull();

      /*
        Both accounts, and their SUM.

        The sum is the assertion that matters: the pair has to come to the refund exactly, because
        the `refund` clearing account is credited that total and a residue there would never clear.
        Reversing the commission alone satisfied neither.
      */
      expect(await reversedOn('safra_commission_partner', booking.id)).toBeCloseTo(
        Number(booking.commission),
        2,
      );
      expect(
        await reversedOn('partner_payable', booking.id),
        'the payable went back too — this is what was missing',
      ).toBeCloseTo(Number(booking.payable), 2);
      expect(
        (await reversedOn('safra_commission_partner', booking.id)) +
          (await reversedOn('partner_payable', booking.id)),
        'the two reversals sum to the stay price',
      ).toBeCloseTo(Number(booking.base), 2);

      const after = await accruedOn('safra_commission_partner');

      expect(before - after, 'accrued fell by exactly the commission').toBeCloseTo(
        Number(booking.commission) * Number(booking.fx),
        0,
      );
    });

    /*
      And the SNAPSHOT the payout run reads.

      `bookings.partner_payable_amount` is what accrual copies onto a payout item, so a reversal
      that reached only the ledger would still have paid the partner in full at the next hourly
      accrual — the books would say one thing and the transfer would do another.
    */
    it('reduces what the payout run will pay for that booking to nothing', async () => {
      const booking = await bookingRefunded(1);

      await ledger.reverseForRefund(db, booking.id);

      const rows = await db.execute<{ payable: string }>(sql`
        SELECT partner_payable_amount::text AS payable FROM bookings WHERE id = ${booking.id}::uuid
      `);

      expect(Number(rows.rows[0]!.payable), 'nothing left to accrue').toBeCloseTo(0, 2);
    });

    /*
      The opposite control, and the reason the accounts cannot share one rule.

      A refunded stay keeps its service fee — `refund.service.ts` calls the fee earned when the
      booking is made, and Bashar left that standing when he decided both the commission question
      and the payable question. A service that applied the refund proportion to all three accounts
      would pass every test above and quietly write off revenue SAFRA is entitled to.
    */
    it('keeps the service fee on that same booking, which is a separate rule', async () => {
      const booking = await bookingRefunded(1);
      const before = await accruedOn('safra_commission_customer');

      await ledger.reverseForRefund(db, booking.id);

      expect(
        await accruedOn('safra_commission_customer'),
        'the fee is untouched by a refund reversal',
      ).toBeCloseTo(before, 0);
    });

    /* Three code paths complete a refund, so calling twice must not give the money back twice. */
    it('reverses once however many times it is asked', async () => {
      const booking = await bookingRefunded(1);

      expect(await ledger.reverseForRefund(db, booking.id)).not.toBeNull();

      const commission = await reversedOn('safra_commission_partner', booking.id);
      const payable = await reversedOn('partner_payable', booking.id);

      expect(
        await ledger.reverseForRefund(db, booking.id),
        'the second call posts nothing',
      ).toBeNull();
      expect(await reversedOn('safra_commission_partner', booking.id)).toBeCloseTo(
        commission,
        2,
      );
      expect(await reversedOn('partner_payable', booking.id)).toBeCloseTo(payable, 2);
    });

    /*
      The invariant the whole reporting split rests on.

      A reversal and a transfer both DEBIT the same account. If the summary cannot tell them apart
      it reports revenue SAFRA gave back as money SAFRA took out — the same figure, the opposite
      meaning. The mark is that a transfer's group credits `safra_payout`.
    */
    it('does not report a reversal as money transferred out', async () => {
      const booking = await bookingRefunded(1);
      const before = await service.revenueSummary();

      await ledger.reverseForRefund(db, booking.id);

      const after = await service.revenueSummary();

      expect(Number(after.transferred), 'transferred did not move').toBeCloseTo(
        Number(before.transferred),
        0,
      );
      expect(Number(after.accrued), 'accrued did').toBeLessThan(Number(before.accrued));
    });

    /*
      Bashar's 2026-09-07 decision, which REVERSED what this test used to assert.

      It used to hold that a partly refunded booking kept its commission in full — the threshold
      was «refunds reached base_amount, or nothing happens». That was the behaviour he ruled
      against: half the stay went back to the customer and SAFRA carried the whole cost while still
      recognising the full commission and owing the partner the full payable.

      Half is chosen because it is the one share where a proportional reversal and a full one are
      unmistakably different figures. A 100%-or-nothing rule fails the first two assertions; a
      rule that reversed everything on any refund at all fails them too, in the other direction.
    */
    it('reverses HALF of each on a booking refunded half way', async () => {
      const booking = await bookingRefunded(0.5);

      expect(await ledger.reverseForRefund(db, booking.id)).not.toBeNull();

      const commission = await reversedOn('safra_commission_partner', booking.id);
      const payable = await reversedOn('partner_payable', booking.id);

      expect(commission, 'half the commission').toBeCloseTo(
        Number(booking.commission) / 2,
        1,
      );
      expect(payable, 'half the payable').toBeCloseTo(Number(booking.payable) / 2, 1);
      expect(
        commission + payable,
        'and together they come to the refund EXACTLY, so the clearing account nets to zero',
      ).toBeCloseTo(Number(booking.base) / 2, 2);
    });

    /*
      A second refund on a booking already partly reversed.

      This is where a service that DECREMENTED its way to the answer drifts: it would compute the
      new proportion against a payable it had already reduced. Every figure is derived from the
      capture's own ledger credits for exactly this reason, so the second call tops the reversal up
      to the full amount rather than reversing a proportion of a proportion.
    */
    it('tops the reversal up when a second refund arrives', async () => {
      const booking = await bookingRefunded(0.5);

      await ledger.reverseForRefund(db, booking.id);
      await addRefund(booking.id, 0.5);
      await ledger.reverseForRefund(db, booking.id);

      expect(
        await reversedOn('safra_commission_partner', booking.id),
        'the whole commission, not three quarters of it',
      ).toBeCloseTo(Number(booking.commission), 2);
      expect(await reversedOn('partner_payable', booking.id)).toBeCloseTo(
        Number(booking.payable),
        2,
      );
    });

    /*
      A refund cannot reverse more than the stay was worth.

      The SAFRA fee is not refundable, so `total_amount` can exceed `base_amount` — and a refund
      recorded for the whole total (or a bad row, or a duplicate) must not debit past what was ever
      credited. Without the clamp the reversal would exceed the credits and leave the partner owed
      a NEGATIVE amount, which reads on their dashboard as a debt to SAFRA.
    */
    it('never gives back more than was credited, whatever the refund says', async () => {
      const booking = await bookingRefunded(1);

      await addRefund(booking.id, 1);
      await ledger.reverseForRefund(db, booking.id);

      const commission = await reversedOn('safra_commission_partner', booking.id);
      const payable = await reversedOn('partner_payable', booking.id);

      expect(commission + payable, 'capped at the stay price').toBeCloseTo(
        Number(booking.base),
        2,
      );
      expect(
        payable,
        'and no further than the payable that was credited',
      ).toBeLessThanOrEqual(Number(booking.payable) + 0.01);
    });

    /*
      A payout that has been accrued but NOT paid still owes the old figure until this fixes it.

      The gap this closes is a booking refunded after the hourly accrual ran and before the
      transfer went out: the item was written from the pre-refund payable, so without this the
      partner is paid for a stay the customer got back. A PAID payout is deliberately left alone —
      money that has moved is a recovery for a person to decide on.
    */
    it('reduces an unpaid payout item and its payout total', async () => {
      const booking = await bookingRefunded(1);

      /*
        `pending_release`, not `accruing`: closed, totalled, and waiting for a human to release it.
        That is precisely the window this test is about — and a partner may only have ONE accruing
        payout per currency, so building a second would collide with the real one.
      */
      const payout = await db.execute<{ id: string }>(sql`
        INSERT INTO partner_payouts (partner_id, currency_id, period_start, period_end,
                                     gross_amount, net_amount, status)
        SELECT b.partner_id, b.currency_id, current_date, current_date,
               b.partner_payable_amount, b.partner_payable_amount, 'pending_release'
          FROM bookings b WHERE b.id = ${booking.id}::uuid
        RETURNING id::text
      `);

      const payoutId = payout.rows[0]!.id;

      await db.execute(sql`
        INSERT INTO partner_payout_items (payout_id, booking_id, amount)
        SELECT ${payoutId}::uuid, b.id, b.partner_payable_amount
          FROM bookings b WHERE b.id = ${booking.id}::uuid
      `);

      await ledger.reverseForRefund(db, booking.id);

      const lines = await db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM partner_payout_items
         WHERE booking_id = ${booking.id}::uuid
      `);
      const after = await db.execute<{ gross: string; net: string }>(sql`
        SELECT gross_amount::text AS gross, net_amount::text AS net
          FROM partner_payouts WHERE id = ${payoutId}::uuid
      `);

      /*
        GONE, not zeroed. `partner_payout_items_positive` forbids a zero line — which is the
        database saying what the reconciliation reader would: a transfer listing a booking worth
        nothing raises a question rather than answering one. The booking cannot re-accrue either,
        because accrual only attaches a payable above zero.
      */
      expect(Number(lines.rows[0]!.n), 'the line is gone').toBe(0);
      expect(
        Number(after.rows[0]!.gross),
        'and the transfer is worth nothing',
      ).toBeCloseTo(0, 2);
      expect(Number(after.rows[0]!.net)).toBeCloseTo(0, 2);

      /* Built here, so it does not sit in the registry as a real transfer afterwards. */
      await db.execute(
        sql`DELETE FROM partner_payout_items WHERE payout_id = ${payoutId}::uuid`,
      );
      await db.execute(sql`DELETE FROM partner_payouts WHERE id = ${payoutId}::uuid`);
    });

    /*
      Bashar's 2026-09-07 rule applied to a booking the LEDGER never captured.

      §13.3 posts the capture group in the same transaction as the status change, so a payable with
      no `partner_payable` credit behind it means the capture never happened — a data-integrity
      fault. `bookings.partner_payable_amount` is then a quote that accrual would nonetheless pay,
      in full, on a stay the guest got money back for.

      «Partner payable amounts should be reduced proportionally to the refunded amount» is a rule
      about the obligation, so it cannot be conditional on there being something to reverse. The
      column comes down; no ledger legs are posted, because debiting an account that was never
      credited would take it negative for money it never held.

      Built rather than found: the state arises from a fault, so no fixture has one, and the
      testbed resets during this work removed the single real example ($613.80 on BKG-2026-425971).
    */
    it('reduces the obligation on a booking whose capture never reached the ledger', async () => {
      const clean = await db.execute<{ id: string; base: string; payable: string }>(sql`
        SELECT b.id::text, b.base_amount::text AS base,
               b.partner_payable_amount::text AS payable
          FROM bookings b
         WHERE b.base_amount > 0
           AND b.partner_payable_amount > 0
           AND abs(b.base_amount - b.partner_commission_amount - b.partner_payable_amount) <= 0.001
           AND NOT EXISTS (SELECT 1 FROM refunds r
                            WHERE r.booking_id = b.id AND r.deleted_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.booking_id = b.id)
           AND EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id)
         LIMIT 1
      `);

      const row = clean.rows[0];

      expect(row, 'a booking with a payable and no ledger at all').toBeDefined();

      await addRefund(row!.id, 0.5);

      /* Null, because there is nothing to reverse — and the column must still move. */
      expect(
        await ledger.reverseForRefund(db, row!.id),
        'no ledger group, because no credits exist to reverse',
      ).toBeNull();

      const after = await db.execute<{ payable: string }>(sql`
        SELECT partner_payable_amount::text AS payable FROM bookings WHERE id = ${row!.id}::uuid
      `);

      expect(Number(after.rows[0]!.payable), 'halved, like the refund').toBeCloseTo(
        Number(row!.payable) / 2,
        1,
      );

      /* And no legs were invented for accounts that never held the money. */
      const posted = await db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM ledger_entries WHERE booking_id = ${row!.id}::uuid
      `);

      expect(Number(posted.rows[0]!.n), 'the ledger is still silent about it').toBe(0);
    });

    /* Reducing the same obligation twice would take it to a quarter. It must converge. */
    it('reduces it to the same figure however many times it is asked', async () => {
      const clean = await db.execute<{ id: string; payable: string }>(sql`
        SELECT b.id::text, b.partner_payable_amount::text AS payable
          FROM bookings b
         WHERE b.base_amount > 0
           AND b.partner_payable_amount > 0
           AND abs(b.base_amount - b.partner_commission_amount - b.partner_payable_amount) <= 0.001
           AND NOT EXISTS (SELECT 1 FROM refunds r
                            WHERE r.booking_id = b.id AND r.deleted_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.booking_id = b.id)
           AND EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id)
         LIMIT 1
      `);

      const row = clean.rows[0];

      expect(row).toBeDefined();
      await addRefund(row!.id, 0.5);

      await ledger.reverseForRefund(db, row!.id);
      const once = await db.execute<{ payable: string }>(sql`
        SELECT partner_payable_amount::text AS payable FROM bookings WHERE id = ${row!.id}::uuid
      `);

      await ledger.reverseForRefund(db, row!.id);
      await ledger.reverseForRefund(db, row!.id);
      const thrice = await db.execute<{ payable: string }>(sql`
        SELECT partner_payable_amount::text AS payable FROM bookings WHERE id = ${row!.id}::uuid
      `);

      expect(
        Number(thrice.rows[0]!.payable),
        'unchanged by the second and third',
      ).toBeCloseTo(Number(once.rows[0]!.payable), 3);
    });

    /*
      The corner the clamp exists for, and it had no test until a mutation proved that.

      `base = commission + payable` holds on nearly every booking and is broken on a few hundred.
      Where it is broken the immutable basis can be LARGER than the obligation on record, and
      multiplying it out would raise what SAFRA owes — reintroducing the exact defect this whole
      change removes, on the bookings least able to withstand it.

      Removing `least(...)` passed every other test here, because they all use fixtures where the
      identity holds. So the broken identity is built deliberately: the payable is set well below
      `base - commission`, and the only acceptable answer is that a refund does not raise it.
    */
    it('never raises the obligation, even where base does not equal commission plus payable', async () => {
      const clean = await db.execute<{ id: string; base: string }>(sql`
        SELECT b.id::text, b.base_amount::text AS base
          FROM bookings b
         WHERE b.base_amount > 100
           AND b.partner_payable_amount > 0
           AND NOT EXISTS (SELECT 1 FROM refunds r
                            WHERE r.booking_id = b.id AND r.deleted_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.booking_id = b.id)
           AND EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id)
         LIMIT 1
      `);

      const row = clean.rows[0];

      expect(row, 'a booking with no ledger to build the broken case on').toBeDefined();

      /*
        Deliberately inconsistent: a tenth of the stay owed, against a commission of nothing. So
        `base - commission` is ten times the obligation, and an unclamped write would multiply THAT
        by the unrefunded share and hand the partner far more than the record ever said.
      */
      await db.execute(sql`
        UPDATE bookings
           SET partner_payable_amount = round(base_amount / 10, 3),
               partner_commission_amount = 0
         WHERE id = ${row!.id}::uuid
      `);

      const before = await db.execute<{ payable: string }>(sql`
        SELECT partner_payable_amount::text AS payable FROM bookings WHERE id = ${row!.id}::uuid
      `);

      await addRefund(row!.id, 0.5);
      await ledger.reverseForRefund(db, row!.id);

      const after = await db.execute<{ payable: string }>(sql`
        SELECT partner_payable_amount::text AS payable FROM bookings WHERE id = ${row!.id}::uuid
      `);

      expect(
        Number(after.rows[0]!.payable),
        'a refund never raises what SAFRA owes',
      ).toBeLessThanOrEqual(Number(before.rows[0]!.payable) + 0.001);
    });

    /* Advertising revenue has no booking, so a join written carelessly deletes the ad business. */
    it('keeps advertising revenue, which has no booking to refund', async () => {
      const summary = await service.revenueSummary();
      const ads = summary.byAccount.find((one) => one.account === 'ad_revenue');

      expect(Number(ads?.accrued), 'ad revenue survives the refund join').toBeGreaterThan(
        0,
      );
    });
  });

  // ── Transfers ─────────────────────────────────────────────────────────────

  describe('a transfer', () => {
    it('opens for a period and computes what it settles', async () => {
      const period = await periodWithRevenue();

      const { id } = await service.open(actor, {
        periodStart: period.from,
        periodEnd: period.to,
      });

      const payout = (await service.payouts()).find((one) => one.id === id);

      expect(payout?.status).toBe('pending_release');
      expect(Number(payout?.netAmount)).toBeGreaterThan(0);
      expect(
        Number(payout?.commissionPartner) +
          Number(payout?.commissionCustomer) +
          Number(payout?.adRevenue),
        'the streams add up to the net',
      ).toBeCloseTo(Number(payout?.netAmount), 2);
    });

    it('refuses a second payout over an overlapping period', async () => {
      const period = await periodWithRevenue();

      await service.open(actor, { periodStart: period.from, periodEnd: period.to });

      expect(
        codeOf(
          await service
            .open(actor, { periodStart: period.from, periodEnd: period.to })
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.SAFRA_PAYOUT_PERIOD_OVERLAP);
    });

    it('refuses a period with nothing accrued in it', async () => {
      expect(
        codeOf(
          await service
            .open(actor, { periodStart: '1990-01-01', periodEnd: '1990-01-31' })
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.SAFRA_PAYOUT_NOTHING_ACCRUED);
    });

    /**
     * The absolute rule, checked at PAYMENT rather than only at opening.
     *
     * Opening and paying are days apart and an account can be rejected or deactivated in between —
     * the same reasoning that made the partner flow re-read its destination on 2026-09-04.
     */
    it('refuses to pay with no verified active destination', async () => {
      const period = await periodWithRevenue();
      const { id } = await service.open(actor, {
        periodStart: period.from,
        periodEnd: period.to,
      });

      await service.release(actor, id);

      expect(
        codeOf(
          await service
            .markPaid(actor, id, { paidReference: 'TRX-1' })
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.SAFRA_PAYOUT_NO_DESTINATION);
    });

    it('refuses to pay into an account that was verified and then deactivated', async () => {
      const acc = await account();

      await service.verifyAccount(actor, acc.id);
      await service.updateAccount(actor, acc.id, { isDefault: true });

      const period = await periodWithRevenue();
      const { id } = await service.open(actor, {
        periodStart: period.from,
        periodEnd: period.to,
      });

      await service.release(actor, id);
      /* Between release and payment, the destination is taken out of service. */
      await service.updateAccount(actor, acc.id, { isActive: false });

      expect(
        codeOf(
          await service
            .markPaid(actor, id, { paidReference: 'TRX-2' })
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.SAFRA_PAYOUT_NO_DESTINATION);
    });

    /**
     * The whole feature, in one assertion: paying moves the BOOKS.
     *
     * A balanced group — a debit per contributing stream, one credit to `safra_payout` — and the
     * summary's `transferred` rises by exactly the net while `accrued` does not move. That last
     * part is what proves the debits landed on the revenue accounts rather than somewhere tidy.
     */
    it('posts a balanced ledger group and moves the outstanding figure', async () => {
      const acc = await account();

      await service.verifyAccount(actor, acc.id);
      await service.updateAccount(actor, acc.id, { isDefault: true });

      const before = await service.revenueSummary();
      const period = await periodWithRevenue();
      const { id } = await service.open(actor, {
        periodStart: period.from,
        periodEnd: period.to,
      });

      await service.release(actor, id);
      await service.markPaid(actor, id, { paidReference: 'TRX-2026-0001' });

      const payout = (await service.payouts()).find((one) => one.id === id);

      expect(payout?.status).toBe('paid');
      expect(payout?.paidReference).toBe('TRX-2026-0001');
      expect(payout?.entryGroupId, 'the payout points at its movement').toBeTruthy();
      expect(payout?.accountLast4, 'and names where it went').toBe('1234');

      /* The group balances: debits equal credits, to the minor unit. */
      const legs = await db.execute<{
        account: string;
        direction: string;
        amount_syp: string;
      }>(sql`
        SELECT account::text, direction::text, amount_syp::text
        FROM ledger_entries WHERE entry_group_id = ${payout!.entryGroupId}::uuid
      `);

      const sum = (direction: string) =>
        legs.rows
          .filter((leg) => leg.direction === direction)
          .reduce((total, leg) => total + Number(leg.amount_syp), 0);

      expect(sum('debit')).toBeCloseTo(sum('credit'), 2);
      expect(sum('credit')).toBeCloseTo(Number(payout!.netAmount), 2);
      expect(
        legs.rows.filter((leg) => leg.account === 'safra_payout'),
        'exactly one credit leg, to SAFRA payout',
      ).toHaveLength(1);

      /* And the summary follows the books rather than a stored balance. */
      const after = await service.revenueSummary();

      expect(Number(after.accrued), 'earning did not change').toBeCloseTo(
        Number(before.accrued),
        2,
      );
      expect(Number(after.transferred) - Number(before.transferred)).toBeCloseTo(
        Number(payout!.netAmount),
        2,
      );
      expect(Number(after.outstanding)).toBeCloseTo(
        Number(before.outstanding) - Number(payout!.netAmount),
        2,
      );
    });

    it('refuses to pay one that was never released', async () => {
      const period = await periodWithRevenue();
      const { id } = await service.open(actor, {
        periodStart: period.from,
        periodEnd: period.to,
      });

      expect(
        codeOf(
          await service
            .markPaid(actor, id, { paidReference: 'TRX-3' })
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.SAFRA_PAYOUT_NOT_PAYABLE);
    });

    it('cannot cancel one that is already paid', async () => {
      const acc = await account();

      await service.verifyAccount(actor, acc.id);
      await service.updateAccount(actor, acc.id, { isDefault: true });

      const period = await periodWithRevenue();
      const { id } = await service.open(actor, {
        periodStart: period.from,
        periodEnd: period.to,
      });

      await service.release(actor, id);
      await service.markPaid(actor, id, { paidReference: 'TRX-4' });

      expect(
        codeOf(
          await service
            .cancel(actor, id, { reason: 'خطأ في الفترة المحدَّدة.' })
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.SAFRA_PAYOUT_ALREADY_FINAL);
    });

    /* A destination a transfer points at cannot be removed — the record would lose its «where». */
    it('refuses to delete a destination a transfer used', async () => {
      const acc = await account();

      await service.verifyAccount(actor, acc.id);
      await service.updateAccount(actor, acc.id, { isDefault: true });

      const period = await periodWithRevenue();

      await service.open(actor, { periodStart: period.from, periodEnd: period.to });

      expect(
        codeOf(
          await service.removeAccount(actor, acc.id).catch((error: unknown) => error),
        ),
      ).toBe(ERROR.CATALOGUE_IN_USE);
    });
  });

  // ── Audit ─────────────────────────────────────────────────────────────────

  /**
   * Every write records, and the trail never carries the account number.
   *
   * The second half is the one worth asserting as a SWEEP: an audit row is the place a masked
   * field most often un-masks itself, because whoever adds a payload key is thinking about
   * debuggability rather than about who reads the log.
   */
  it('audits both lifecycles without ever recording the number', async () => {
    const acc = await account();

    await service.verifyAccount(actor, acc.id);
    await service.updateAccount(actor, acc.id, { isDefault: true });

    const period = await periodWithRevenue();
    const { id } = await service.open(actor, {
      periodStart: period.from,
      periodEnd: period.to,
    });

    await service.release(actor, id);
    await service.markPaid(actor, id, { paidReference: 'TRX-5' });

    const rows = await db.execute<{ action: string; payload: string }>(sql`
      SELECT action, (coalesce(before, '{}'::jsonb) || coalesce(after, '{}'::jsonb))::text AS payload
      FROM audit_log
      WHERE action LIKE 'safra_payout%'
        /*
          THIS test's two subjects, not every SAFRA audit row ever written.

          Unscoped, it read the whole table and picked up the browser suite's committed transfer,
          then asserted that row carried an account number this test never created. The subject id
          is what ties an audit row to the thing it describes, so it is what the query filters on.
        */
        AND subject_id IN (${acc.id}::uuid, ${id}::uuid)
      ORDER BY created_at
    `);

    const actions = rows.rows.map((row) => row.action);

    expect(actions).toContain('safra_payout_account.created');
    expect(actions).toContain('safra_payout_account.verified');
    expect(actions).toContain('safra_payout.opened');
    expect(actions).toContain('safra_payout.released');
    expect(actions).toContain('safra_payout.paid');

    for (const row of rows.rows) {
      expect(row.payload, `${row.action} recorded the account number`).not.toContain(
        'SY12',
      );
      expect(row.payload, `${row.action} recorded the account number`).not.toContain(
        '34567890',
      );
    }

    /* The paid row names WHERE it went — the question an auditor asks first. */
    const paid = rows.rows.find((row) => row.action === 'safra_payout.paid');

    expect(paid?.payload).toContain('1234');
    expect(paid?.payload).toContain('TRX-5');
  });
});
