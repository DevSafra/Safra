import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { PricingService } from './pricing.service.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * A partner's negotiated commission, priced against a real database.
 *
 * Bashar (2026-08-31): «add a نسبة العمولة in % and the max range in $ … The super admin will
 * define the values for each partner manually.»
 *
 * ## What these cases really guard
 *
 * Not that the columns save — that is the easy half, and a field that saves and prices nothing is
 * the «built and connected to nothing» shape this codebase keeps producing. What is asserted here
 * is that a quote CHANGES: the rate a super admin types is the rate the booking is billed at, and
 * the ceiling they type is a ceiling the commission actually stops at.
 *
 * The distinction that matters most is `null` versus `0`. A partner nobody has negotiated with
 * uses the platform rate; a partner who negotiated zero commission pays nothing. A `coalesce`, or
 * a `||` in the service, would collapse those two into one and bill one of them wrongly — so both
 * are asserted separately, and the zero case is the one that fails against that mistake.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a partner’s negotiated commission', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const pricing = new PricingService(
    db,
    new SettingsService(db),
    new FxRateService(db, new AuditService(db)),
  );

  let unitId = '';
  let partnerId = '';
  let checkIn = '';
  let checkOut = '';

  beforeEach(async () => {
    await harness.begin();

    /*
      A real seeded unit priced in USD, and the partner behind it. Using what is there rather than
      building a property tree keeps the test about PRICING; every column it needs already exists.
    */
    const found = await db.execute<{
      unit_id: string;
      partner_id: string;
    }>(sql`
      SELECT u.id::text AS unit_id, pr.partner_id::text AS partner_id
      FROM units u
      JOIN properties pr ON pr.id = u.property_id
      JOIN currencies cur ON cur.id = u.currency_id
      WHERE cur.code = 'USD' AND u.deleted_at IS NULL AND pr.deleted_at IS NULL
      LIMIT 1
    `);

    unitId = found.rows[0]?.unit_id ?? '';
    partnerId = found.rows[0]?.partner_id ?? '';

    /* Two nights far enough out that no seeded availability row overrides the price. */
    const dates = await db.execute<{ a: string; b: string }>(sql`
      SELECT (now() + interval '400 days')::date::text AS a,
             (now() + interval '402 days')::date::text AS b
    `);

    checkIn = dates.rows[0]?.a ?? '';
    checkOut = dates.rows[0]?.b ?? '';
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const setTerms = async (rate: string | null, cap: string | null): Promise<void> => {
    await db.execute(sql`
      UPDATE partners SET commission_rate = ${rate}, commission_cap_usd = ${cap}
      WHERE id = ${partnerId}::uuid
    `);
  };

  const commissionOf = async (): Promise<number> =>
    Number((await pricing.quote({ unitId, checkIn, checkOut })).partnerCommissionAmount);

  it('bills the platform rate when the partner has negotiated none', async () => {
    await setTerms(null, null);

    const platform = await new SettingsService(db).getNumber(
      'commission.partner_rate',
      0,
    );
    const quote = await pricing.quote({ unitId, checkIn, checkOut });

    expect(Number(quote.partnerCommissionRate)).toBeCloseTo(platform, 6);
    /* The opposite control: there IS a commission, so the assertions below can move it. */
    expect(Number(quote.partnerCommissionAmount)).toBeGreaterThan(0);
  });

  it('bills the partner’s own rate when they have one', async () => {
    await setTerms(null, null);
    const atPlatform = await commissionOf();

    await setTerms('0.2000', null);
    const atTwenty = await commissionOf();

    expect(atTwenty).toBeGreaterThan(atPlatform);

    const quote = await pricing.quote({ unitId, checkIn, checkOut });

    expect(Number(quote.partnerCommissionRate)).toBeCloseTo(0.2, 6);
  });

  /**
   * Zero is a DEAL, not an absence.
   *
   * This is the case a `coalesce` or a `||` gets wrong: both would read `0` as «nothing set» and
   * fall back to the platform rate, billing a zero-commission partner seven percent of every
   * booking. Nothing else in this file fails against that mistake.
   */
  it('bills nothing when the partner negotiated zero, rather than falling back', async () => {
    await setTerms('0.0000', null);

    expect(await commissionOf()).toBe(0);
  });

  it('stops the commission at the ceiling', async () => {
    await setTerms('0.5000', null);
    const uncapped = await commissionOf();

    expect(uncapped).toBeGreaterThan(1);

    /* A ceiling below what the rate would take, so it has to bite. */
    const cap = Math.floor(uncapped / 2);

    await setTerms('0.5000', String(cap));

    expect(await commissionOf()).toBe(cap);
  });

  it('leaves the commission alone when the ceiling is above it', async () => {
    await setTerms('0.0500', null);
    const uncapped = await commissionOf();

    await setTerms('0.0500', String(uncapped + 1000));

    expect(await commissionOf()).toBe(uncapped);
  });
});
