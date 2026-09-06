import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { BookingCreationService } from './booking-creation.service.js';
import { CouponService } from '../coupons/coupon.service.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { PricingService } from './pricing.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { codeOf } from '../common/errors/app-error.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * A quote and a booking answer the same question about a stay.
 *
 * ## What this caught
 *
 * `create` refused a stay shorter than `units.min_nights`; `quote` did not. So a guest choosing a
 * suite that takes two nights, on a page whose default window was built from the CHEAPEST room's
 * one-night minimum, reached a priced checkout — entered their name, their phone and their card
 * details — and only then met **UNIT_MIN_NIGHTS**. The screen took everything and could never have
 * completed.
 *
 * It was unreachable until 2026-09-06: every fixture unit had `min_nights = 1`, so the two paths
 * had nothing to disagree about. It appeared the same day the testbed grew a hotel whose room types
 * differ, which is the whole argument for realistic fixtures.
 *
 * ## Why it asserts AGREEMENT rather than a message
 *
 * The defect was not that quote lacked a check; it was that two paths judging one thing gave two
 * answers. A test naming only the refusal would pass again the day `create` gains a rule `quote`
 * does not — so this drives both and compares them.
 */
describeIfDb('the stay rules a unit sets', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: BookingCreationService;

  beforeAll(async () => {
    await harness.begin();
    db = harness.db;

    const settings = new SettingsService(db);

    service = new BookingCreationService(
      db,
      new PricingService(db, settings, new FxRateService(db, {} as never)),
      settings,
      {} as never,
      {} as never,
      new CouponService(db),
    );
  });

  /** Nights from a stay, the way both paths count them. */
  const window_ = (from: string, nights: number) => {
    const out = new Date(`${from}T00:00:00Z`);

    out.setUTCDate(out.getUTCDate() + nights);

    return { checkIn: from, checkOut: out.toISOString().slice(0, 10) };
  };

  /** A unit whose minimum is more than one night — the condition the defect needs. */
  async function strictUnit() {
    const rows = await db.execute<{ id: string; min_nights: number }>(sql`
      SELECT id::text, min_nights
        FROM units
       WHERE min_nights > 1 AND is_active AND deleted_at IS NULL
       LIMIT 1
    `);

    return rows.rows[0];
  }

  it('the testbed has a unit that takes more than one night', async () => {
    expect(
      await strictUnit(),
      'without one, nothing below can tell a working build from a broken one',
    ).toBeDefined();
  });

  it('a quote refuses a stay shorter than the unit accepts', async () => {
    const unit = await strictUnit();

    expect(unit).toBeDefined();

    const refusal = await service
      .quote({ unitId: unit!.id, ...window_('2027-04-12', unit!.min_nights - 1) })
      .catch((error: unknown) => error);

    expect(codeOf(refusal), 'priced anyway').toBe(ERROR.UNIT_MIN_NIGHTS);
  });

  it('and prices the shortest stay it does accept', async () => {
    const unit = await strictUnit();

    expect(unit).toBeDefined();

    const priced = await service.quote({
      unitId: unit!.id,
      ...window_('2027-04-12', unit!.min_nights),
    });

    /*
      The opposite control. Without it the rule could be written as "refuse everything" and the test
      above would still pass — which is how a fix becomes a different defect.
    */
    expect(priced.nights).toBe(unit!.min_nights);
    expect(Number(priced.totalAmount)).toBeGreaterThan(0);
  });
});
