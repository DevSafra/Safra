import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR, PERMISSIONS as P } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { ArrivalsService } from './arrivals.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { ViolationsService } from './violations.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * وصول الضيوف and المخالفات against a real PostgreSQL.
 *
 * Two screens built for capabilities that were grantable and had nothing behind them. Everything
 * worth proving here is a boundary:
 *
 * 1. **Isolation.** Both lists are one business's, and the check-in write carries the partner id in
 *    its `WHERE` rather than checking afterwards. So there are always TWO partners in the fixtures
 *    and the assertion is about what the second one cannot reach.
 * 2. **Money.** A violation carries a fine, and `violation.read` is not `payout.read_own`. The test
 *    that matters is not that an employee sees null — it is that the OWNER sees the figure, because
 *    a service that withheld money from everybody would pass the first assertion perfectly.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('arrivals and violations', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const arrivals = new ArrivalsService(db, new AuditService(db));
  const violations = new ViolationsService(db);

  let partnerId = '';
  let neighbourId = '';
  let unitId = '';
  let neighbourUnitId = '';
  /* Real rows: the audit log has a foreign key to `users`, so a made-up actor id fails the write. */
  let ownerUserId = '';
  let neighbourUserId = '';
  let employeeUserId = '';

  /** The owner: holds `payout.read_own`, so money is visible. */
  const owner = (id: string, sub = ownerUserId): AccessTokenClaims => ({
    sub,
    role: 'partner',
    permissions: [P.BOOKING_CHECK_IN, P.VIOLATION_READ, P.PAYOUT_READ_OWN],
    locale: 'ar',
    partnerId: id,
  });

  /**
   * An employee: the SAME partner id, and no `payout.read_own`.
   *
   * That is what `attachOwningIds` puts on the token — an employee is scoped to their employer, and
   * the only thing separating them from the owner is the capability list.
   */
  const employee = (id: string): AccessTokenClaims => ({
    sub: employeeUserId,
    role: 'partner_employee',
    permissions: [P.BOOKING_CHECK_IN, P.VIOLATION_READ],
    locale: 'ar',
    partnerId: id,
  });

  async function makePartner(): Promise<{
    partnerId: string;
    unitId: string;
    userId: string;
  }> {
    const made = await db.execute<{
      partner_id: string;
      unit_id: string;
      user_id: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD') AS currency_id,
               (SELECT id FROM property_types LIMIT 1) AS type_id,
               (SELECT id FROM partner_types LIMIT 1) AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1) AS policy_id
      ), u AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('arr-test-' || gen_random_uuid() || '@safra.test', '+963900000000',
                'partner', 'active', 'ar')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT u.id, ref.partner_type_id, 'Arr Test', 'Arr Test', ref.city_id,
               'x', '+963900000000', 'arr@safra.test', 'approved'
        FROM u, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'arr-test-' || gen_random_uuid(), 'فندق', 'Test', 'Test', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'غرفة', 'Unit', 'Unit', 2, '100.00', ref.currency_id
        FROM pr, ref RETURNING id, property_id
      )
      SELECT pr.partner_id, un.id AS unit_id, (SELECT id FROM u) AS user_id
      FROM un JOIN pr ON pr.id = un.property_id
    `);

    return {
      partnerId: made.rows[0]?.partner_id ?? '',
      unitId: made.rows[0]?.unit_id ?? '',
      userId: made.rows[0]?.user_id ?? '',
    };
  }

  /** A real employee account, so the audit log's foreign key to `users` is satisfied. */
  async function makeEmployeeUser(): Promise<string> {
    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status, preferred_locale)
      VALUES ('arr-emp-' || gen_random_uuid() || '@safra.test', '+963900000002',
              'partner_employee', 'active', 'ar')
      RETURNING id
    `);

    return made.rows[0]?.id ?? '';
  }

  /** One booking, dated by day offsets from the CITY's today — the same clock the service uses. */
  async function makeBooking(options: {
    unit: string;
    partner: string;
    status: string;
    fromDay: number;
  }): Promise<string> {
    const { unit, partner, status, fromDay } = options;

    const made = await db.execute<{ reference: string }>(sql`
      WITH cp AS (
        INSERT INTO customer_profiles (full_name, email, phone, is_guest)
        VALUES ('ضيف', 'arr-guest-' || gen_random_uuid() || '@safra.test',
                '+963900000001', true)
        RETURNING id
      )
      INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                            check_in, check_out, guests_adults, status,
                            base_amount, customer_fee_value, customer_fee_amount,
                            partner_commission_rate, partner_commission_amount,
                            total_amount, partner_payable_amount, currency_id,
                            fx_rate_to_syp, total_syp, cancellation_policy_snapshot,
                            confirmed_at, checked_in_at)
      SELECT cp.id, un.id, un.property_id, ${partner}, pr.city_id,
             ((now() AT TIME ZONE c.timezone)::date + ${fromDay}::int)::date,
             ((now() AT TIME ZONE c.timezone)::date + ${fromDay}::int + 2)::date,
             2, ${status}::booking_status,
             '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
             un.currency_id, '12500.00000000', '2524875.00', '{"code":"flex"}'::jsonb,
             CASE WHEN ${status} IN ('confirmed','completed','checked_in')
                  THEN now() - interval '30 minute' END,
             CASE WHEN ${status} = 'checked_in' THEN now() END
      FROM cp, units un
      JOIN properties pr ON pr.id = un.property_id
      JOIN cities c ON c.id = pr.city_id
      WHERE un.id = ${unit}
      RETURNING reference
    `);

    return made.rows[0]?.reference ?? '';
  }

  async function makeViolation(partner: string, waived = false): Promise<void> {
    await db.execute(sql`
      INSERT INTO partner_violations (partner_id, kind, occurrence_number, fine_amount,
                                      fine_currency_id, customer_compensation_amount,
                                      score_penalty, waived_at, waived_reason)
      SELECT ${partner}::uuid, 'no_response', 1, '50.00',
             (SELECT id FROM currencies WHERE code = 'USD'), '50.00', 5,
             ${waived ? sql`now()` : sql`NULL`},
             ${waived ? 'عذر مقبول' : null}
    `);
  }

  /** A violation carrying the two sentences the console asks an operator to write. */
  async function makeDescribedViolation(partner: string): Promise<void> {
    await db.execute(sql`
      INSERT INTO partner_violations (partner_id, kind, occurrence_number, stage,
                                      description, fine_amount, fine_currency_id,
                                      fine_reason, score_penalty)
      VALUES (${partner}::uuid, 'stale_calendar', 1, 'fined',
              ${'تقويم الوحدة ١٠١ لم يُحدَّث منذ أحد عشر يوماً.'}, '50.00',
              (SELECT id FROM currencies WHERE code = 'USD'),
              ${'مخالفة متكررة بعد إشعارين سابقين.'}, 0)
    `);
  }

  /** A violation that has been WARNED, so the stage and the note have something to be. */
  async function makeWarnedViolation(partner: string, note: string): Promise<void> {
    await db.execute(sql`
      INSERT INTO partner_violations (partner_id, kind, occurrence_number, stage,
                                      warned_at, warning_note, score_penalty)
      VALUES (${partner}::uuid, 'stale_calendar', 1, 'fined', now(), ${note}, 0)
    `);
  }

  beforeEach(async () => {
    await harness.begin();

    const mine = await makePartner();
    const theirs = await makePartner();

    partnerId = mine.partnerId;
    unitId = mine.unitId;
    ownerUserId = mine.userId;
    neighbourId = theirs.partnerId;
    neighbourUnitId = theirs.unitId;
    neighbourUserId = theirs.userId;
    employeeUserId = await makeEmployeeUser();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  // ─── وصول الضيوف ───────────────────────────────────────────────────────────

  describe('the arrivals list', () => {
    it('shows a confirmed booking arriving today', async () => {
      const reference = await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'confirmed',
        fromDay: 0,
      });

      const page = await arrivals.list(partnerId, { limit: 20 });

      expect(page.items.map((item) => item.reference)).toEqual([reference]);
      expect(page.items[0]?.checkedInAt).toBeNull();
      expect(page.items[0]?.guests).toBe(2);
    });

    /**
     * A guest arriving at 01:00 for a booking dated yesterday is the case a strict "today" filter
     * loses, and it is the one where the desk most needs the button.
     */
    it('still shows a confirmed arrival whose date has passed', async () => {
      const reference = await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'confirmed',
        fromDay: -1,
      });

      const page = await arrivals.list(partnerId, { limit: 20 });

      expect(page.items.map((item) => item.reference)).toEqual([reference]);
    });

    it('does not show a booking arriving in the future', async () => {
      await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'confirmed',
        fromDay: 3,
      });

      await expect(arrivals.list(partnerId, { limit: 20 })).resolves.toMatchObject({
        items: [],
      });
    });

    /** Isolation. A join one table too wide would show a competitor's guest list by name. */
    it("never shows another business's arrival", async () => {
      const theirs = await makeBooking({
        unit: neighbourUnitId,
        partner: neighbourId,
        status: 'confirmed',
        fromDay: 0,
      });

      const mine = await arrivals.list(partnerId, { limit: 20 });

      expect(mine.items).toEqual([]);

      /* Control: the booking exists and its OWNER can see it, so the emptiness is the scope. */
      const neighbours = await arrivals.list(neighbourId, { limit: 20 });

      expect(neighbours.items.map((item) => item.reference)).toEqual([theirs]);
    });

    it('refuses a forged cursor', async () => {
      await expect(
        arrivals.list(partnerId, { limit: 20, cursor: 'not-a-cursor' }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  /**
   * §6.5's lookup — the reason the day's list is not the whole screen.
   *
   * The case is a guest holding a printed voucher for a stay that is NOT today, which the list is
   * built to exclude. So the first assertion here is deliberately the one the list would fail.
   */
  describe('looking a booking up by its reference', () => {
    it('finds a booking the day’s list deliberately does not show', async () => {
      const future = await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'confirmed',
        fromDay: 3,
      });

      /* The control: the list really does exclude it, so the lookup is doing the work. */
      await expect(arrivals.list(partnerId, { limit: 20 })).resolves.toMatchObject({
        items: [],
      });

      await expect(arrivals.find(partnerId, future)).resolves.toMatchObject({
        reference: future,
        status: 'confirmed',
      });
    });

    it("cannot find another business's booking, and its owner still can", async () => {
      const theirs = await makeBooking({
        unit: neighbourUnitId,
        partner: neighbourId,
        status: 'confirmed',
        fromDay: 0,
      });

      await expect(arrivals.find(partnerId, theirs)).rejects.toMatchObject({
        status: 404,
      });

      /*
        The opposite control, without which the refusal above is indistinguishable from a lookup
        that finds nothing for anybody.
      */
      await expect(arrivals.find(neighbourId, theirs)).resolves.toMatchObject({
        reference: theirs,
      });
    });

    /** §6.5's «أو اسم العميل» — the guest who has lost the reference too. */
    it('finds a booking by the guest’s name, and only within this business', async () => {
      const mine = await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'confirmed',
        fromDay: 5,
      });

      const hits = await arrivals.search(partnerId, 'ضيف');

      expect(
        hits.map((hit) => hit.reference),
        'the name matches',
      ).toContain(mine);

      /* The control: the neighbour searching the same name finds nothing of ours. */
      const theirs = await arrivals.search(neighbourId, 'ضيف');

      expect(theirs.map((hit) => hit.reference)).not.toContain(mine);
    });

    it('takes a reference through the same box, and refuses a one-character term', async () => {
      const mine = await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'confirmed',
        fromDay: 6,
      });

      expect((await arrivals.search(partnerId, mine)).map((h) => h.reference)).toEqual([
        mine,
      ]);

      /* Too short to be a search: one letter would return a slice of the whole guest list. */
      expect(await arrivals.search(partnerId, 'ض')).toEqual([]);
    });

    it('answers a malformed reference exactly as a missing one', async () => {
      const missing = await arrivals
        .find(partnerId, 'BKG-2026-999999')
        .catch((error: unknown) => error);
      const malformed = await arrivals
        .find(partnerId, 'not-a-reference')
        .catch((error: unknown) => error);

      expect(malformed).toMatchObject({ status: 404 });

      /*
        Same CODE, not merely the same status — the code is what a client can read.

        Read off `response`, which is where `app-error.ts` puts it. It was read off the exception's
        own `.code`, which does not exist: both sides were `undefined`, so the comparison held for
        every possible pair of errors and proved nothing. Pinned to the expected value as well as
        to each other, so «both undefined» can never be the reason this passes again.
      */
      const codeOf = (error: unknown): unknown =>
        (error as { response?: { code?: string } }).response?.code;

      expect(codeOf(malformed)).toBe(ERROR.BOOKING_NOT_FOUND);
      expect(codeOf(missing)).toBe(ERROR.BOOKING_NOT_FOUND);
    });
  });

  describe('checking a guest in', () => {
    it('moves a confirmed booking to checked in, and back', async () => {
      const reference = await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'confirmed',
        fromDay: 0,
      });

      const after = await arrivals.checkIn(owner(partnerId), partnerId, reference);

      expect(after.status).toBe('checked_in');
      expect(after.checkedInAt).not.toBeNull();

      const undone = await arrivals.undoCheckIn(owner(partnerId), partnerId, reference);

      expect(undone.status).toBe('confirmed');
      expect(undone.checkedInAt).toBeNull();
    });

    /**
     * The status is in the `WHERE`, not read and compared, so the second press matches no rows.
     * Two clerks pressing at once is the ordinary version of this, and it must not double-write.
     */
    it('refuses a second check-in of the same booking', async () => {
      const reference = await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'confirmed',
        fromDay: 0,
      });

      await arrivals.checkIn(owner(partnerId), partnerId, reference);

      await expect(
        arrivals.checkIn(owner(partnerId), partnerId, reference),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('refuses to undo a check-in that never happened', async () => {
      const reference = await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'confirmed',
        fromDay: 0,
      });

      await expect(
        arrivals.undoCheckIn(owner(partnerId), partnerId, reference),
      ).rejects.toMatchObject({ status: 404 });
    });

    /** A cancelled booking whose guest turns up is a conversation with SAFRA, not a button. */
    it('refuses to check in a cancelled booking', async () => {
      const reference = await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'cancelled',
        fromDay: 0,
      });

      await expect(
        arrivals.checkIn(owner(partnerId), partnerId, reference),
      ).rejects.toMatchObject({ status: 404 });
    });

    /**
     * The partner id is a `WHERE` clause. "Not yours" answers the same as "not there", and the row
     * must be UNTOUCHED afterwards — a 404 raised after a successful write would pass a test that
     * only checked the exception.
     */
    it("cannot check in another business's guest, and does not touch the row", async () => {
      const theirs = await makeBooking({
        unit: neighbourUnitId,
        partner: neighbourId,
        status: 'confirmed',
        fromDay: 0,
      });

      await expect(
        arrivals.checkIn(owner(partnerId), partnerId, theirs),
      ).rejects.toMatchObject({ status: 404 });

      const row = await db.execute<{ status: string; checked_in_at: string | null }>(sql`
        SELECT status::text AS status, checked_in_at::text FROM bookings
        WHERE reference = ${theirs}
      `);

      expect(row.rows[0]?.status).toBe('confirmed');
      expect(row.rows[0]?.checked_in_at).toBeNull();
    });

    /**
     * A reference that is not shaped like one is refused BEFORE the query.
     *
     * Not about injection — the lookup is parameterised — but about not handing Postgres a
     * megabyte of caller-chosen text on a route any signed-in employee may call sixty times a
     * minute. 404 rather than 400, so "not a reference" and "not your booking" answer the same and
     * nobody can learn the format by watching which refusal differs.
     */
    it('refuses a reference that is not shaped like one', async () => {
      for (const bad of [
        'x'.repeat(5000),
        '../../etc/passwd',
        'BKG-',
        "BKG-2026-1' OR '1'='1",
      ]) {
        await expect(
          arrivals.checkIn(owner(partnerId), partnerId, bad),
          bad.slice(0, 20),
        ).rejects.toMatchObject({ status: 404 });
      }
    });

    /** An employee with the capability may do the job — that is the point of the capability. */
    it('lets an employee of the business check a guest in', async () => {
      const reference = await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'confirmed',
        fromDay: 0,
      });

      await expect(
        arrivals.checkIn(employee(partnerId), partnerId, reference),
      ).resolves.toMatchObject({ status: 'checked_in' });
    });
  });

  // ─── المخالفات ─────────────────────────────────────────────────────────────

  describe('the violations list', () => {
    it('shows this business’s violations, with the fine, to the owner', async () => {
      await makeViolation(partnerId);

      const page = await violations.list(owner(partnerId), partnerId, { limit: 20 });

      expect(page.moneyHidden).toBe(false);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.kind).toBe('no_response');
      expect(page.items[0]?.fineAmount).toBe('50.00');
      expect(page.items[0]?.fineCurrency).toBe('USD');
      expect(page.items[0]?.customerCompensationAmount).toBe('50.00');
      expect(page.items[0]?.scorePenalty).toBe(5);
    });

    /**
     * The DESCRIPTION reaches the partner — the sentence this screen most needed and never had.
     *
     * `violationRaiseSchema` has always required a reason with a twenty-character floor, and the
     * console labels the field «الوصف (يقرأه الشريك)». It was written to `audit_log.reason` and
     * nowhere else, so `partner_violations` had no column for it and this list could show only a
     * kind, a stage, an occurrence number and a figure. A business was told it had been fined and
     * never told what for. Reported by Bashar from the screen on 2026-08-24.
     */
    it('sends the description and the fine reason to the owner', async () => {
      await makeDescribedViolation(partnerId);

      const page = await violations.list(owner(partnerId), partnerId, { limit: 20 });

      expect(page.items[0]?.description).toBe(
        'تقويم الوحدة ١٠١ لم يُحدَّث منذ أحد عشر يوماً.',
      );
      expect(page.items[0]?.fineReason).toBe('مخالفة متكررة بعد إشعارين سابقين.');
    });

    /**
     * The fine's REASON follows the fine's own visibility rule, and the description does not.
     *
     * An employee holds `violation.read` and not `payout.read_own`, so every money figure is
     * withheld from them. A sentence explaining a fine is about the fine: sending it while hiding
     * the amount would leak what the rule protects, one field over, in prose. The DESCRIPTION is
     * about the violation rather than the money, so it stays — an employee who may know the
     * business was cited may know what for.
     */
    it('withholds the fine reason from a reader without payout.read_own, and keeps the description', async () => {
      await makeDescribedViolation(partnerId);

      const page = await violations.list(employee(partnerId), partnerId, { limit: 20 });

      expect(page.items[0]?.fineReason).toBeNull();
      expect(page.items[0]?.description).toBe(
        'تقويم الوحدة ١٠١ لم يُحدَّث منذ أحد عشر يوماً.',
      );
    });

    /**
     * The stage and the warning REACH the partner, which for a long time they did not.
     *
     * `violations.service.ts` selected neither `stage` nor `warning_note`, and the portal's zod
     * schema carried `.default('recorded')` and `.default(null)` for them — so nothing failed and
     * every violation a partner opened reported «سُجّلت» whatever had really happened to it, while
     * the sentence somebody wrote FOR them was never sent at all. A default turned a missing field
     * into a plausible one.
     *
     * Asserted on a violation whose stage is `fined`, deliberately: `recorded` is the value the
     * old default invented, so a test written against a recorded violation would have passed
     * against the defect it is meant to catch.
     */
    it('sends the stage and the warning note the partner was written', async () => {
      await makeWarnedViolation(partnerId, 'حدّث تقويمك خلال ٢٤ ساعة.');

      const page = await violations.list(owner(partnerId), partnerId, { limit: 20 });

      expect(page.items[0]?.stage).toBe('fined');
      expect(page.items[0]?.warningNote).toBe('حدّث تقويمك خلال ٢٤ ساعة.');
      expect(page.items[0]?.warnedAt).not.toBeNull();
    });

    /**
     * THE assertion this screen exists to get right, and the one above is its control.
     *
     * An employee holds `violation.read` and not `payout.read_own`. Without the pairing, a service
     * that withheld money from everyone would pass this and be wrong; without this, one that
     * withheld it from nobody would pass that.
     */
    it('withholds every money figure from a reader without payout.read_own', async () => {
      await makeViolation(partnerId);

      const page = await violations.list(employee(partnerId), partnerId, { limit: 20 });

      expect(page.moneyHidden).toBe(true);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.fineAmount).toBeNull();
      expect(page.items[0]?.fineCurrency).toBeNull();
      expect(page.items[0]?.customerCompensationAmount).toBeNull();

      /* What the screen is FOR is still there: what happened, and what it cost in score. */
      expect(page.items[0]?.kind).toBe('no_response');
      expect(page.items[0]?.scorePenalty).toBe(5);
    });

    /**
     * A waived violation stays on the list.
     *
     * A row that vanishes when it is forgiven looks like one that was never written, and the
     * partner cannot tell that SAFRA acted on their appeal.
     */
    it('shows a waived violation, marked as waived', async () => {
      await makeViolation(partnerId, true);

      const page = await violations.list(owner(partnerId), partnerId, { limit: 20 });

      expect(page.items[0]?.waived).toBe(true);
      expect(page.items[0]?.waivedReason).toBe('عذر مقبول');
    });

    it("never shows another business's violation", async () => {
      await makeViolation(neighbourId);

      await expect(
        violations.list(owner(partnerId), partnerId, { limit: 20 }),
      ).resolves.toMatchObject({ items: [] });

      /* Control: it exists, and its owner sees it. */
      const theirs = await violations.list(
        owner(neighbourId, neighbourUserId),
        neighbourId,
        { limit: 20 },
      );

      expect(theirs.items).toHaveLength(1);
    });

    /**
     * The DETAIL endpoint, and this is the assertion that matters for it.
     *
     * `GET /partner/violations/:id` takes an id from the URL. Scoped after the fact, a partner could
     * read any violation on the platform by trying uuids — another business's enforcement record,
     * including its fine. The scope is in the WHERE clause, so the row is unreachable rather than
     * merely unreturned, and it answers `VIOLATION_NOT_FOUND`: the same answer a uuid that exists
     * nowhere gets, so the response cannot be used to discover that a violation exists.
     *
     * The control underneath is the half that makes this mean something — "refused" is
     * indistinguishable from "broken" until the owner is shown reading the same row.
     */
    it("cannot open another business's violation, and its owner still can", async () => {
      const made = await db.execute<{ id: string }>(sql`
        INSERT INTO partner_violations (partner_id, kind, occurrence_number, stage, score_penalty)
        VALUES (${neighbourId}::uuid, 'stale_calendar', 1, 'recorded', 0)
        RETURNING id
      `);
      const id = made.rows[0]?.id ?? '';

      await expect(violations.one(owner(partnerId), partnerId, id)).rejects.toMatchObject(
        {
          response: { code: 'violation.not_found' },
        },
      );

      /* Control: the row exists and its owner reads it. */
      const theirs = await violations.one(
        owner(neighbourId, neighbourUserId),
        neighbourId,
        id,
      );

      expect(theirs.violation.id).toBe(id);
    });

    /** A uuid that belongs to nobody answers exactly as one that belongs to somebody else. */
    it('answers the same for a violation that does not exist at all', async () => {
      await expect(
        violations.one(
          owner(partnerId),
          partnerId,
          '00000000-0000-4000-8000-000000000000',
        ),
      ).rejects.toMatchObject({ response: { code: 'violation.not_found' } });
    });

    /**
     * The detail endpoint obeys the money rule too — the easiest place to forget it.
     *
     * An employee holds `violation.read` and not `payout.read_own`. The list withholds every figure
     * from them; a detail screen written later, with its own query, is exactly where that would be
     * dropped. The fine's REASON goes with the figures, because a sentence explaining a fine is
     * about the fine.
     */
    it('withholds the figures and the fine reason on the detail, for an employee', async () => {
      await makeDescribedViolation(partnerId);

      const page = await violations.list(owner(partnerId), partnerId, { limit: 20 });
      const id = page.items[0]?.id ?? '';

      const asEmployee = await violations.one(employee(partnerId), partnerId, id);

      expect(asEmployee.moneyHidden).toBe(true);
      expect(asEmployee.violation.fineAmount).toBeNull();
      expect(asEmployee.violation.fineReason).toBeNull();
      /* And what happened is still theirs to read. */
      expect(asEmployee.violation.description).not.toBeNull();
    });

    it('refuses a forged cursor', async () => {
      await expect(
        violations.list(owner(partnerId), partnerId, { limit: 20, cursor: 'nope' }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
