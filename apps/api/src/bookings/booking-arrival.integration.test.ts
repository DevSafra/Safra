import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { BookingCreationService } from './booking-creation.service.js';
import { CouponService } from '../coupons/coupon.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { codeOf } from '../common/errors/app-error.js';

/**
 * The two ways an arrival date can be refused, and the shape of the refusal.
 *
 * ## Why this suite exists
 *
 * §5.3's same-day cutoff and the past-arrival check both answered with an English sentence chosen by
 * a ternary — `{message: "Today's bookings have closed for this city.", reason, firstBookableDate}`.
 * The customer app translated the cutoff case itself by reading `reason`, and had no branch at all
 * for a past arrival, so that one fell through to a fallback that wrote the API's English straight
 * onto an Arabic checkout form.
 *
 * Nothing covered either path — no integration test, no browser spec — which is why it survived the
 * i18n sweep that produced `error-codes.ts`. This is the cover.
 *
 * ## Why the service is built with three stubs
 *
 * `BookingCreationService` takes five collaborators, and the arrival verdict is decided before any
 * of pricing, audit or booking-access is touched: it needs the unit row and the cutoff hour, so
 * `db` and `SettingsService` are real and the rest are never reached. Assembling the whole container
 * to reach line 130 would test the container.
 */
/**
 * The fixture city's timezone, named ONCE.
 *
 * `days()` computes dates in it and the seed writes it onto the city. Two copies of a timezone is
 * the same defect as the one this constant fixes, one step later: the helper and the fixture would
 * agree until somebody changed one of them.
 */
const CITY_TIMEZONE = 'Asia/Damascus';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a refused arrival date', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: BookingCreationService;
  let unitId: string;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;

    service = new BookingCreationService(
      db,
      {} as never,
      new SettingsService(db),
      {} as never,
      {} as never,
      new CouponService(db),
    );

    unitId = await publishedUnit(db);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  const draft = (checkIn: string, checkOut: string) =>
    service.createDraft(
      {
        unitId,
        checkIn,
        checkOut,
        adults: 2,
        guest: {
          fullName: 'Arrival Test',
          email: `arrival-${Math.random().toString(36).slice(2, 10)}@safra.test`,
          phone: '+963900000123',
        },
      },
      undefined,
      { ipAddress: '127.0.0.1', userAgent: 'test' },
    );

  const refusal = (checkIn: string, checkOut: string): Promise<unknown> =>
    draft(checkIn, checkOut).catch((error: unknown) => error);

  /**
   * `n` days from today IN THE CITY, not in UTC.
   *
   * `evaluateArrival` judges an arrival date against the CITY's local date — the fixture city is
   * `Asia/Damascus`, UTC+3 — so a helper that counted from the UTC date disagreed with it for the
   * three hours between 21:00 UTC and midnight. During that window `days(0)` returned yesterday's
   * date in Damascus, and the same-day-cutoff test was answered `arrival_in_past`, correctly.
   *
   * It passed for twenty-one hours a day, which is the worst possible failure rate: too rare to be
   * anybody's first suspicion, and reliable enough to cost the next person an evening reading their
   * own diff. Found by project-cc at 21:20 UTC on 2026-08-23, in a suite where nothing they had
   * touched was involved.
   */
  const days = (n: number): string => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: CITY_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    /* Noon UTC, so adding whole days cannot cross a boundary through any offset or DST shift. */
    const at = new Date(`${today}T12:00:00Z`);

    at.setUTCDate(at.getUTCDate() + n);

    return at.toISOString().slice(0, 10);
  };

  it('answers a past arrival with a code, not a sentence', async () => {
    expect(codeOf(await refusal(days(-3), days(-1)))).toBe(ERROR.BOOKING_ARRIVAL_IN_PAST);
  });

  /**
   * The date the customer CAN book travels as a param.
   *
   * Without it the client resolving the code in Arabic has nothing to fill `{date}` with and prints
   * the placeholder — which is the defect Bashar reported on the registration form (2026-08-14) and
   * the reason `ErrorBody` carries `params` at all.
   */
  it('carries the first bookable date so a client can interpolate it', async () => {
    const error = (await refusal(days(-3), days(-1))) as {
      getResponse: () => { params?: Record<string, unknown> };
    };

    expect(error.getResponse().params?.['date']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /**
   * The regression, stated as an absence.
   *
   * `message` still travels for logs — that is deliberate and documented — but the body must not be
   * the ONLY thing a client can read, and it must not be what the client reads. Asserting the
   * English text is gone would freeze the wording; asserting a code is present is the contract.
   */
  it('does not rely on an English sentence to say what happened', async () => {
    const body = (
      (await refusal(days(-3), days(-1))) as {
        getResponse: () => Record<string, unknown>;
      }
    ).getResponse();

    expect(body['code']).toBeTypeOf('string');
    expect(body['reason'], 'the old ad-hoc field is gone').toBeUndefined();
    expect(body['firstBookableDate'], 'moved into params').toBeUndefined();
  });

  /**
   * The cutoff refusal is a DIFFERENT code from the past-arrival one.
   *
   * They were two branches of a ternary over one English string, so nothing stopped them collapsing
   * into one message. A customer told "today's bookings have closed" can wait until tomorrow; one
   * told "that date has passed" has to pick a new date. Forcing the cutoff to bite by setting the
   * city's cutoff hour to 0, so every same-day arrival is past it.
   */
  it('distinguishes the same-day cutoff from a date in the past', async () => {
    await db.execute(sql`
      UPDATE cities SET same_day_cutoff_hour = 0
      WHERE id = (SELECT p.city_id FROM units u JOIN properties p ON p.id = u.property_id
                   WHERE u.id = ${unitId})
    `);

    expect(codeOf(await refusal(days(0), days(2)))).toBe(ERROR.BOOKING_SAME_DAY_CLOSED);
  });

  /** And a date comfortably ahead is not refused by this check at all. */
  it('lets a future arrival past this check', async () => {
    expect(codeOf(await refusal(days(45), days(47)))).not.toBe(
      ERROR.BOOKING_ARRIVAL_IN_PAST,
    );
    expect(codeOf(await refusal(days(45), days(47)))).not.toBe(
      ERROR.BOOKING_SAME_DAY_CLOSED,
    );
  });
});

/**
 * A published, active unit of its own, rather than whichever fixture happens to be first.
 *
 * The cutoff test WRITES to the city row, so it needs a city it is allowed to change — and a suite
 * that mutated a shared fixture city would change what later specs measure even though the rollback
 * puts it back.
 */
async function publishedUnit(db: Database): Promise<string> {
  const tag = `arr-${Math.random().toString(36).slice(2, 10)}`;

  const made = await db.execute<{ id: string }>(sql`
    WITH ref AS (
      SELECT (SELECT id FROM countries WHERE deleted_at IS NULL LIMIT 1)  AS country_id,
             (SELECT id FROM currencies WHERE code = 'USD')               AS currency_id,
             (SELECT id FROM property_types LIMIT 1)                      AS type_id,
             (SELECT id FROM partner_types LIMIT 1)                       AS partner_type_id,
             (SELECT id FROM cancellation_policies LIMIT 1)               AS policy_id
    ), ci AS (
      INSERT INTO cities (country_id, slug, name_ar, name_en, name_de, timezone)
      SELECT ref.country_id, ${tag}, 'مدينة', 'City', 'Stadt', ${CITY_TIMEZONE} FROM ref
      RETURNING id
    ), pu AS (
      INSERT INTO users (email, phone, role, status)
      VALUES (${tag} || '-p@safra.test', '+963900000188', 'partner', 'active')
      RETURNING id
    ), pa AS (
      INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                            address, phone, email, verification)
      SELECT pu.id, ref.partner_type_id, 'Arrival Test', 'وصول', ci.id, 'x',
             '+963900000188', ${tag} || '-pa@safra.test', 'approved'
      FROM pu, ci, ref RETURNING id
    ), pr AS (
      INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                              slug, name_ar, name_en, name_de, address, status)
      SELECT pa.id, ci.id, ref.type_id, ref.policy_id, ${tag}, ${tag}, 'Arrival', 'Arrival', 'x',
             'published'
      FROM pa, ci, ref RETURNING id
    )
    INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                       currency_id, is_active)
    SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 4, '100.00', ref.currency_id, true
    FROM pr, ref
    RETURNING id
  `);

  const id = made.rows[0]?.id;

  if (!id) throw new Error('Could not create the unit this suite books against.');

  return id;
}
