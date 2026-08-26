import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { CalendarService } from './calendar.service.js';
import type { AuditService } from '../common/audit/audit.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Integration test against a REAL PostgreSQL.
 *
 * The behaviour under test lives in SQL — an ON CONFLICT upsert whose per-field
 * semantics cannot be exercised by a mock. It is skipped when DATABASE_URL is
 * unset so local `pnpm test` stays fast, and runs in CI where a database is
 * provisioned.
 *
 * Regression guard for a bug that shipped and was caught in manual testing: a
 * price-only calendar edit silently reset `closed` days back to `available`,
 * making unavailable units sellable. That is an overbooking, not a cosmetic
 * defect, so it gets a permanent test.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// Valid hex only — 'l' is not a hex digit and Postgres rejects it as a uuid.
const PARTNER_ID = '99990000-0000-0000-0000-0000000000c1';
const PROPERTY_ID = '99990000-0000-0000-0000-0000000000c2';
const UNIT_ID = '99990000-0000-0000-0000-0000000000c3';
const USER_ID = '99990000-0000-0000-0000-0000000000c4';

/**
 * A partner's real token: `calendar.manage_own` AND `price.update`.
 *
 * `ROLE_PERMISSIONS.partner` carries both, so this is what an owner actually holds — the fixture
 * named only the first, and three tests here set a nightly rate. They passed until `price.update`
 * started binding, then failed as 403s, which is the check doing its job on an under-specified
 * fixture rather than a regression. See `deskClerk` below for the account that legitimately has
 * one and not the other.
 */
const claims: AccessTokenClaims = {
  sub: USER_ID,
  role: 'partner',
  permissions: ['calendar.manage_own', 'price.update'],
  locale: 'ar',
  partnerId: PARTNER_ID,
};

/** An employee who may close dates and may NOT decide what a night costs. */
const deskClerk: AccessTokenClaims = {
  sub: USER_ID,
  role: 'partner_employee',
  permissions: ['calendar.manage_own'],
  locale: 'ar',
  partnerId: PARTNER_ID,
};

describeIfDb('CalendarService.updateRange — field-level upsert semantics', () => {
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: CalendarService;

  beforeEach(async () => {
    await harness.begin();

    db = harness.db;

    // Audit writes are not what this test covers; a no-op keeps the fixture small.
    const audit = { record: () => Promise.resolve() } as unknown as AuditService;
    service = new CalendarService(db, audit);

    await seed(db);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('creates rows for a range and defaults new days to available', async () => {
    const result = await service.updateRange(claims, UNIT_ID, {
      from: '2030-01-10',
      to: '2030-01-12',
      price: 150,
    });

    expect(result.daysAffected).toBe(3);

    const { days } = await service.read(claims, UNIT_ID, {
      from: '2030-01-10',
      to: '2030-01-12',
    });

    // A price-only write must not fail on status NOT NULL, and must materialise
    // the only sensible default.
    expect(days.map((d) => d.status)).toEqual(['available', 'available', 'available']);
    expect(days.every((d) => d.isPriceOverridden)).toBe(true);
  });

  it('PRESERVES a closed status when only the price is edited', async () => {
    await service.updateRange(claims, UNIT_ID, {
      from: '2030-02-01',
      to: '2030-02-03',
      status: 'closed',
    });

    await service.updateRange(claims, UNIT_ID, {
      from: '2030-02-01',
      to: '2030-02-02',
      price: 200,
    });

    const { days } = await service.read(claims, UNIT_ID, {
      from: '2030-02-01',
      to: '2030-02-03',
    });

    // THE regression: these must still be closed. If any reads 'available', a
    // partner adjusting a price has silently put unavailable inventory on sale.
    expect(days.find((d) => d.date === '2030-02-01')?.status).toBe('closed');
    expect(days.find((d) => d.date === '2030-02-02')?.status).toBe('closed');
    expect(days.find((d) => d.date === '2030-02-03')?.status).toBe('closed');
    expect(days.find((d) => d.date === '2030-02-01')?.price).toBe('200.000');
  });

  it('preserves status when only minNights is edited', async () => {
    await service.updateRange(claims, UNIT_ID, {
      from: '2030-03-01',
      to: '2030-03-01',
      status: 'maintenance',
    });

    await service.updateRange(claims, UNIT_ID, {
      from: '2030-03-01',
      to: '2030-03-01',
      minNights: 4,
    });

    const { days } = await service.read(claims, UNIT_ID, {
      from: '2030-03-01',
      to: '2030-03-01',
    });

    expect(days[0]?.status).toBe('maintenance');
    expect(days[0]?.minNights).toBe(4);
  });

  it('applies an explicit status change', async () => {
    /*
      Close the span FIRST, in this test.

      It used to rely on the preceding test having closed it — which passed only because the suite
      committed and ran in order. A test that depends on its predecessor is a test that reports the
      wrong thing the day somebody reorders the file, and it is what stopped this suite rolling back.
    */
    await service.updateRange(claims, UNIT_ID, {
      from: '2030-02-01',
      to: '2030-02-03',
      status: 'closed',
    });

    await service.updateRange(claims, UNIT_ID, {
      from: '2030-02-02',
      to: '2030-02-02',
      status: 'available',
    });

    const { days } = await service.read(claims, UNIT_ID, {
      from: '2030-02-01',
      to: '2030-02-03',
    });

    // Only the targeted day reopens; its neighbours stay closed.
    expect(days.find((d) => d.date === '2030-02-01')?.status).toBe('closed');
    expect(days.find((d) => d.date === '2030-02-02')?.status).toBe('available');
    expect(days.find((d) => d.date === '2030-02-03')?.status).toBe('closed');
  });

  it('clears a price override when null is passed explicitly', async () => {
    await service.updateRange(claims, UNIT_ID, {
      from: '2030-01-10',
      to: '2030-01-10',
      price: null,
    });

    const { days } = await service.read(claims, UNIT_ID, {
      from: '2030-01-10',
      to: '2030-01-10',
    });

    // Falls back to the unit's base price, and says so.
    expect(days[0]?.isPriceOverridden).toBe(false);
    expect(days[0]?.price).toBe('80.000');
  });

  it('refuses a unit belonging to another partner', async () => {
    const otherPartner: AccessTokenClaims = {
      ...claims,
      partnerId: '99990000-0000-0000-0000-0000000000cf',
    };

    await expect(
      service.updateRange(otherPartner, UNIT_ID, {
        from: '2030-01-10',
        to: '2030-01-10',
        status: 'closed',
      }),
    ).rejects.toThrow(/not found/i);
  });

  /**
   * `price.update` binds on the CALENDAR too, and only on the price.
   *
   * The nightly override is a price like any other, and it arrives on the same request as closing
   * a date. So the capability is checked against the FIELD rather than the route: a desk clerk may
   * close a week and may not decide what a night costs.
   */
  describe('who may set a nightly rate', () => {
    it('refuses a price from an account without price.update', async () => {
      await expect(
        service.updateRange(deskClerk, UNIT_ID, {
          from: '2026-09-01',
          to: '2026-09-03',
          price: 250,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    /**
     * Clearing an override is a price change too.
     *
     * The new number comes from the unit's base rate rather than from the request, and that does
     * not make it somebody else's decision — the guest is charged something different afterwards.
     */
    it('refuses clearing an override from the same account', async () => {
      await expect(
        service.updateRange(deskClerk, UNIT_ID, {
          from: '2026-09-01',
          to: '2026-09-03',
          price: null,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    /**
     * The control, and the half that matters more.
     *
     * Closing dates is the desk clerk's job. If this failed, the check would have become a route
     * guard by accident — which is precisely what it exists instead of.
     */
    it('lets the same account close a range', async () => {
      await expect(
        service.updateRange(deskClerk, UNIT_ID, {
          from: '2026-09-01',
          to: '2026-09-03',
          status: 'closed',
        }),
      ).resolves.toMatchObject({ daysAffected: 3 });
    });
  });
});

async function seed(db: Database): Promise<void> {
  const { sql } = await import('drizzle-orm');

  // One statement per execute(): a parameterised query cannot carry multiple
  // commands, so these cannot be batched into a single template.
  await db.execute(sql`
    INSERT INTO users (id, email, role)
    VALUES (${claims.sub}::uuid, 'calendar-test@safra.test', 'partner')
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO partners (id, user_id, partner_type_id, legal_name, display_name, city_id,
                          address, phone, email)
    SELECT ${PARTNER_ID}::uuid, ${claims.sub}::uuid, pt.id, 'Cal Test', 'اختبار', c.id,
           'Addr', '+963900000000', 'calendar-test@safra.test'
    FROM partner_types pt, cities c
    WHERE pt.code = 'accommodation' AND c.slug = 'damascus'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO properties (id, partner_id, city_id, property_type_id, slug,
                            name_ar, name_en, name_de, address, cancellation_policy_id, status)
    SELECT ${PROPERTY_ID}::uuid, ${PARTNER_ID}::uuid, c.id, pt.id, 'calendar-test-property',
           'اختبار', 'Calendar Test', 'Test', 'Addr', cp.id, 'draft'
    FROM cities c, property_types pt, cancellation_policies cp
    WHERE c.slug = 'damascus' AND pt.code = 'apartment' AND cp.code = 'flex'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO units (id, property_id, name_ar, name_en, name_de, max_guests,
                       base_price, currency_id, min_nights)
    SELECT ${UNIT_ID}::uuid, ${PROPERTY_ID}::uuid, 'وحدة', 'Unit', 'Einheit', 2, 80, cu.id, 1
    FROM currencies cu WHERE cu.code = 'USD'
    LIMIT 1
    ON CONFLICT DO NOTHING`);
}

/* A second property for the same partner, and a whole second partner to be kept out of the answer. */
const PROPERTY2_ID = '99990000-0000-0000-0000-0000000000d2';
const UNIT2_ID = '99990000-0000-0000-0000-0000000000d3';
const UNIT3_ID = '99990000-0000-0000-0000-0000000000d4';
const EMPTY_PROPERTY_ID = '99990000-0000-0000-0000-0000000000d5';
const RIVAL_USER_ID = '99990000-0000-0000-0000-0000000000e1';
const RIVAL_PARTNER_ID = '99990000-0000-0000-0000-0000000000e2';
const RIVAL_PROPERTY_ID = '99990000-0000-0000-0000-0000000000e3';
const RIVAL_UNIT_ID = '99990000-0000-0000-0000-0000000000e4';

/**
 * `readPortfolio` — every unit's month, grouped under its property (Bashar, 2026-08-10).
 *
 * Against a real PostgreSQL because all of the behaviour is in SQL: the month is derived with
 * interval arithmetic, the keyset page is a tuple comparison, and the booking overlay is a join. A
 * mock would assert the shape of the code rather than what the database answers.
 */
describeIfDb(
  'CalendarService.readPortfolio — the whole portfolio, a month at a time',
  () => {
    const harness = createRollbackDatabase(DATABASE_URL ?? '');
    let db: Database;
    let service: CalendarService;

    beforeEach(async () => {
      await harness.begin();
      db = harness.db;

      const audit = { record: () => Promise.resolve() } as unknown as AuditService;
      service = new CalendarService(db, audit);

      await seed(db);
      await seedPortfolio(db);
    });

    afterEach(async () => {
      await harness.rollback();
    });

    afterAll(async () => {
      await harness.close();
    });

    it('groups units under the property that owns them, in portfolio order', async () => {
      const result = await service.readPortfolio(claims, { month: '2030-01', limit: 10 });

      expect(result.month).toBe('2030-01');
      /* Ordered by `created_at, id` — the portfolio as it grew, which the fixture sets explicitly. */
      expect(result.properties.map((p) => p.nameAr)).toStrictEqual([
        'اختبار',
        'الثاني',
        'الفارغ',
      ]);
      expect(result.properties[0]?.units.map((u) => u.nameAr)).toStrictEqual(['وحدة']);
      expect(result.properties[1]?.units.map((u) => u.nameAr)).toStrictEqual([
        'وحدة ٢',
        'وحدة ٣',
      ]);
    });

    /**
     * The unit's own number, carried to the screen where a partner picks a room.
     *
     * `units.unit_label` has existed since the schema was written — "the physical identifier the
     * partner uses at check-in" — and no screen ever showed it (Bashar, 2026-08-19). This is the
     * screen that most needs it: «غرفة مزدوجة» is shared by every double room in the building, so
     * the name alone cannot tell a partner which room they are about to close for a week.
     *
     * Null is asserted alongside, because most units have no number and the heading must simply
     * omit it rather than print an empty label.
     */
    it('carries each unit number, and null where there is none', async () => {
      /* The unit this partner's portfolio actually returns first — not whichever row the table
         happens to hold, which in a shared fixture belongs to somebody else. */
      const before = await service.readPortfolio(claims, { month: '2030-01', limit: 10 });
      const target = before.properties.flatMap((property) => property.units)[0]?.unitId;

      expect(target, 'the fixture has a unit to number').toBeDefined();

      await db.execute(
        sql`UPDATE units SET unit_label = '204' WHERE id = ${target}::uuid`,
      );

      const result = await service.readPortfolio(claims, { month: '2030-01', limit: 10 });
      const labels = result.properties.flatMap((property) =>
        property.units.map((unit) => unit.unitLabel),
      );

      expect(labels[0]).toBe('204');
      /* The rest were never given one, and arrive as null rather than as an empty string. */
      expect(labels.slice(1).every((label) => label === null)).toBe(true);
    });

    /**
     * A property with no units is still a property.
     *
     * The grouping is seeded from the property PAGE rather than from the day rows, precisely so this
     * case appears as itself. Built from the rows instead, an empty property would vanish — which
     * reads as the screen having lost it rather than as a property having no rooms yet.
     */
    it('lists a property that has no units at all', async () => {
      const result = await service.readPortfolio(claims, { month: '2030-01', limit: 10 });
      const empty = result.properties.find((p) => p.nameAr === 'الفارغ');

      expect(empty).toBeDefined();
      expect(empty?.units).toStrictEqual([]);
    });

    /**
     * The month is derived in SQL, so February and a leap February have to come out right.
     *
     * `+ 1 month - 1 day` is the whole reason there is no month-length table in TypeScript, and it is
     * the kind of arithmetic that is either exactly right or off by one on four days a year.
     */
    it.each([
      ['2030-01', 31],
      ['2030-02', 28],
      ['2032-02', 29],
      ['2030-04', 30],
    ])('answers every day of %s — %i days', async (month, expected) => {
      const result = await service.readPortfolio(claims, { month, limit: 10 });
      const unit = result.properties[0]?.units[0];

      expect(unit?.days).toHaveLength(expected);
      expect(unit?.days[0]?.date).toBe(`${month}-01`);
      expect(unit?.days.at(-1)?.date).toBe(
        `${month}-${String(expected).padStart(2, '0')}`,
      );
    });

    /**
     * ANOTHER partner's property never appears, whatever the caller asks for.
     *
     * The service takes no partner id — it derives one from the verified token — so this asserts the
     * thing that makes that design worth having rather than merely tidy.
     */
    it('never returns a property belonging to another partner', async () => {
      const result = await service.readPortfolio(claims, { month: '2030-01', limit: 10 });
      const references = result.properties.map((p) => p.reference);
      const units = result.properties.flatMap((p) => p.units.map((u) => u.unitId));

      expect(units).not.toContain(RIVAL_UNIT_ID);
      expect(result.properties.map((p) => p.nameAr)).not.toContain('منافس');

      const rival = await db.execute<{ reference: string }>(
        (await import('drizzle-orm')).sql`
        SELECT reference FROM properties WHERE id = ${RIVAL_PROPERTY_ID}::uuid`,
      );

      expect(references).not.toContain(rival.rows[0]?.reference);
    });

    /**
     * ONE property's days, and the rest listed without them.
     *
     * This is the whole shape of the screen: days are the expensive part — a property times its
     * units times every day of the month — so expanding every listed property forced a ceiling of
     * ten and put a partner's eleventh property out of reach (Bashar, 2026-08-19).
     *
     * The unexpanded properties keep their UNITS, and that is deliberate rather than incidental: a
     * folder has to say «٥ وحدة» while it is still shut, or the reader must open every one to find
     * out where anything is.
     */
    it('expands only the property named by expand, and lists the rest with their units', async () => {
      const listed = await service.readPortfolio(claims, { month: '2030-01', limit: 10 });
      const second = listed.properties.find(
        (property) =>
          property.units.length > 0 &&
          property.reference !== listed.properties[0]?.reference,
      );

      expect(second, 'the fixture has a second property with units').toBeDefined();

      const result = await service.readPortfolio(claims, {
        month: '2030-01',
        limit: 10,
        expand: second?.reference ?? '',
      });

      const opened = result.properties.find((p) => p.reference === second?.reference);
      const others = result.properties.filter((p) => p.reference !== second?.reference);

      expect(opened?.units.every((unit) => unit.days.length === 31)).toBe(true);
      expect(others.every((p) => p.units.every((unit) => unit.days.length === 0))).toBe(
        true,
      );
      /* Listed, with everything the shut folder shows — the name, the number, the nightly price. */
      expect(others.some((p) => p.units.length > 0)).toBe(true);
      expect(result.properties).toHaveLength(listed.properties.length);
    });

    /** Absent `expand` opens the first property, so the screen never arrives without a calendar. */
    it('expands the first property when expand is absent', async () => {
      const result = await service.readPortfolio(claims, { month: '2030-01', limit: 10 });

      expect(result.properties[0]?.units[0]?.days).toHaveLength(31);
    });

    /**
     * `expand` is a caller-supplied string, and the answer to a hostile one is the ordinary answer.
     *
     * The scoping is the page query, not a check on this parameter: a reference belonging to another
     * partner simply does not match any row the caller was given, so it falls back to the first of
     * their OWN properties. "Not yours" and "not there" are therefore the same answer, and neither
     * confirms that the reference exists.
     */
    it("falls back to the reader's own first property when expand is not one of theirs", async () => {
      const rival = await db.execute<{ reference: string }>(
        sql`SELECT reference FROM properties WHERE id = ${RIVAL_PROPERTY_ID}::uuid`,
      );

      for (const expand of [
        rival.rows[0]?.reference ?? 'PRO-000000',
        'not-a-reference',
      ]) {
        const result = await service.readPortfolio(claims, {
          month: '2030-01',
          limit: 10,
          expand,
        });

        expect(result.properties.map((p) => p.reference)).not.toContain(
          rival.rows[0]?.reference,
        );
        expect(result.properties[0]?.units[0]?.days).toHaveLength(31);
      }
    });

    /**
     * The cursor walks the portfolio without repeating or skipping a property.
     *
     * The repeat is the failure mode worth naming: `created_at` is a `timestamptz` with microsecond
     * precision, and a cursor that round-tripped its sort key through a millisecond JavaScript Date
     * would put the boundary row at the top of the NEXT page as well.
     */
    it('pages by property, and the pages neither repeat nor skip', async () => {
      const first = await service.readPortfolio(claims, { month: '2030-01', limit: 2 });

      expect(first.properties).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await service.readPortfolio(claims, {
        month: '2030-01',
        limit: 2,
        cursor: first.nextCursor ?? '',
      });

      expect(second.properties).toHaveLength(1);
      /* The end of the portfolio, so no further cursor is offered. */
      expect(second.nextCursor).toBeNull();

      const seen = [...first.properties, ...second.properties].map((p) => p.reference);

      expect(new Set(seen).size).toBe(3);
    });

    /** A malformed cursor is a 400, not a silent restart that loops a client for ever. */
    it.each([['not-base64-at-all'], [Buffer.from('no-separator').toString('base64url')]])(
      'refuses the malformed cursor %s',
      async (cursor) => {
        await expect(
          service.readPortfolio(claims, { month: '2030-01', limit: 2, cursor }),
        ).rejects.toThrow();
      },
    );

    /**
     * A cursor whose id is not a uuid is a 400 rather than a 500.
     *
     * It reaches a `::uuid` cast in the keyset comparison, so without the check in front of it a
     * forged cursor would surface as a database error.
     */
    it('refuses a cursor carrying something that is not a uuid', async () => {
      const forged = Buffer.from(`2030-01-01T00:00:00Z|not-a-uuid`).toString('base64url');

      await expect(
        service.readPortfolio(claims, { month: '2030-01', limit: 2, cursor: forged }),
      ).rejects.toThrow();
    });

    /**
     * An off-sale unit is RETURNED, and marked.
     *
     * The opposite of the dashboard's counters, which exclude it because a customer cannot book it.
     * This screen says what the partner owns, and a room that quietly disappeared from it would look
     * like data loss.
     */
    it('includes an inactive unit, flagged rather than hidden', async () => {
      const { sql } = await import('drizzle-orm');

      await db.execute(
        sql`UPDATE units SET is_active = false WHERE id = ${UNIT3_ID}::uuid`,
      );

      const result = await service.readPortfolio(claims, { month: '2030-01', limit: 10 });
      const units = result.properties.flatMap((p) => p.units);

      expect(units.find((u) => u.unitId === UNIT3_ID)?.isActive).toBe(false);
      expect(units.find((u) => u.unitId === UNIT2_ID)?.isActive).toBe(true);
    });

    /**
     * A live booking wins over whatever the partner declared, exactly as the per-unit read does.
     *
     * Both calendars read one `OCCUPYING_STATUSES` fragment for this, so the assertion is really that
     * the two screens cannot disagree about whether a night is taken.
     */
    it('shows a booked night as booked even where the partner set it available', async () => {
      const { sql } = await import('drizzle-orm');

      await db.execute(sql`
      INSERT INTO availability_days (unit_id, date, status)
      VALUES (${UNIT_ID}::uuid, '2030-01-15'::date, 'available')
      ON CONFLICT (unit_id, date) DO UPDATE SET status = 'available'`);

      /* The same booking fixture `dashboard.integration.test.ts` uses, on fixed dates. */
      await db.execute(sql`
      WITH cp AS (
        INSERT INTO customer_profiles (full_name, email, phone, is_guest)
        VALUES ('Cal Guest', 'cal-guest-' || gen_random_uuid() || '@safra.test',
                '+963900000002', true)
        RETURNING id
      )
      INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                            check_in, check_out, guests_adults, status,
                            base_amount, customer_fee_value, customer_fee_amount,
                            partner_commission_rate, partner_commission_amount,
                            total_amount, partner_payable_amount, currency_id,
                            fx_rate_to_syp, total_syp, cancellation_policy_snapshot,
                            confirmed_at)
      SELECT cp.id, un.id, un.property_id, ${PARTNER_ID}::uuid, pr.city_id,
             '2030-01-15'::date, '2030-01-17'::date, 2, 'confirmed'::booking_status,
             '200.000', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
             un.currency_id, '12500.00000000', '2524875.00', '{"code":"flex"}'::jsonb,
             now()
      FROM cp, units un JOIN properties pr ON pr.id = un.property_id
      WHERE un.id = ${UNIT_ID}::uuid`);

      const result = await service.readPortfolio(claims, { month: '2030-01', limit: 10 });
      const days = result.properties[0]?.units[0]?.days ?? [];
      const status = (date: string) => days.find((d) => d.date === date)?.status;

      expect(status('2030-01-15')).toBe('booked');
      expect(status('2030-01-16')).toBe('booked');
      /* Check-out day is not an occupied night — the guest leaves that morning. */
      expect(status('2030-01-17')).toBe('available');
    });
  },
);

/** The extra fixtures the portfolio tests need, on top of `seed`. */
async function seedPortfolio(db: Database): Promise<void> {
  const { sql } = await import('drizzle-orm');

  /*
    `created_at` is set EXPLICITLY. Every statement in one transaction shares the same `now()`, so
    left to the default all three properties would tie and the order would fall to the uuid
    tiebreaker — which is stable but says nothing about the ordering this screen promises.
  */
  await db.execute(sql`
    UPDATE properties SET created_at = '2030-01-01T00:00:00Z'
    WHERE id = ${PROPERTY_ID}::uuid`);

  await db.execute(sql`
    INSERT INTO properties (id, partner_id, city_id, property_type_id, slug,
                            name_ar, name_en, name_de, address, cancellation_policy_id, status,
                            created_at)
    SELECT ${PROPERTY2_ID}::uuid, ${PARTNER_ID}::uuid, c.id, pt.id, 'calendar-test-property-2',
           'الثاني', 'Second', 'Zweite', 'Addr', cp.id, 'draft', '2030-01-02T00:00:00Z'
    FROM cities c, property_types pt, cancellation_policies cp
    WHERE c.slug = 'damascus' AND pt.code = 'apartment' AND cp.code = 'flex'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO properties (id, partner_id, city_id, property_type_id, slug,
                            name_ar, name_en, name_de, address, cancellation_policy_id, status,
                            created_at)
    SELECT ${EMPTY_PROPERTY_ID}::uuid, ${PARTNER_ID}::uuid, c.id, pt.id, 'calendar-test-empty',
           'الفارغ', 'Empty', 'Leer', 'Addr', cp.id, 'draft', '2030-01-03T00:00:00Z'
    FROM cities c, property_types pt, cancellation_policies cp
    WHERE c.slug = 'damascus' AND pt.code = 'apartment' AND cp.code = 'flex'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO units (id, property_id, name_ar, name_en, name_de, max_guests,
                       base_price, currency_id, min_nights, created_at)
    SELECT ${UNIT2_ID}::uuid, ${PROPERTY2_ID}::uuid, 'وحدة ٢', 'Unit 2', 'Einheit 2', 2, 90, cu.id,
           1, '2030-01-04T00:00:00Z'
    FROM currencies cu WHERE cu.code = 'USD' LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO units (id, property_id, name_ar, name_en, name_de, max_guests,
                       base_price, currency_id, min_nights, created_at)
    SELECT ${UNIT3_ID}::uuid, ${PROPERTY2_ID}::uuid, 'وحدة ٣', 'Unit 3', 'Einheit 3', 2, 95, cu.id,
           1, '2030-01-05T00:00:00Z'
    FROM currencies cu WHERE cu.code = 'USD' LIMIT 1
    ON CONFLICT DO NOTHING`);

  /* A whole second partner, whose inventory must never appear in the answer above. */
  await db.execute(sql`
    INSERT INTO users (id, email, role)
    VALUES (${RIVAL_USER_ID}::uuid, 'calendar-rival@safra.test', 'partner')
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO partners (id, user_id, partner_type_id, legal_name, display_name, city_id,
                          address, phone, email)
    SELECT ${RIVAL_PARTNER_ID}::uuid, ${RIVAL_USER_ID}::uuid, pt.id, 'Rival', 'منافس', c.id,
           'Addr', '+963900000001', 'calendar-rival@safra.test'
    FROM partner_types pt, cities c
    WHERE pt.code = 'accommodation' AND c.slug = 'damascus'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO properties (id, partner_id, city_id, property_type_id, slug,
                            name_ar, name_en, name_de, address, cancellation_policy_id, status)
    SELECT ${RIVAL_PROPERTY_ID}::uuid, ${RIVAL_PARTNER_ID}::uuid, c.id, pt.id, 'calendar-rival-prop',
           'منافس', 'Rival', 'Rivale', 'Addr', cp.id, 'draft'
    FROM cities c, property_types pt, cancellation_policies cp
    WHERE c.slug = 'damascus' AND pt.code = 'apartment' AND cp.code = 'flex'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO units (id, property_id, name_ar, name_en, name_de, max_guests,
                       base_price, currency_id, min_nights)
    SELECT ${RIVAL_UNIT_ID}::uuid, ${RIVAL_PROPERTY_ID}::uuid, 'وحدة منافس', 'Rival Unit',
           'Rivale', 2, 70, cu.id, 1
    FROM currencies cu WHERE cu.code = 'USD' LIMIT 1
    ON CONFLICT DO NOTHING`);
}
