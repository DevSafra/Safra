import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';

import { SearchService } from './search.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { SearchQuery } from '@safra/contracts';

/**
 * §5.2 search, against a real PostgreSQL.
 *
 * ## Why this exists, and why it exists now
 *
 * Search had NO tests. It is 80 % of real traffic (`docs/load-testing.md`), it is the most
 * complicated single statement in the codebase — four anti-joins, a correlated price sum, a
 * DISTINCT ON and a window function — and nothing checked any of it.
 *
 * It was written to make the `O-scale-2` rewrite safe. A query that takes 144 seconds at production
 * volumes has to change shape, and "the results still look right" is not something anybody can
 * verify by reading a 140-line SQL statement. So these characterise the CURRENT behaviour first:
 * every one of them passed against the original query before a line of it was touched, which is what
 * makes them evidence that the rewrite preserves meaning rather than a description of whatever it
 * happens to do now.
 *
 * ## What is deliberately asserted
 *
 * The rules a guest would notice: what is bookable, what a stay costs when the partner has priced
 * individual nights, which unit represents a property, and what each filter and sort actually does.
 * Not the plan — that is measured separately, against `safra_load`.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** Far enough out that the same-day cutoff (§5.3) never interferes. */
const IN = 30;
const OUT = 32;

function isoDate(days: number): string {
  const at = new Date();

  at.setUTCDate(at.getUTCDate() + days);

  return at.toISOString().slice(0, 10);
}

describeIfDb('SearchService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const search = new SearchService(db, new SettingsService(db));

  /** The city these fixtures live in, so the suite never sees the rest of the database. */
  let citySlug = '';
  let cheapPropertySlug = '';
  let dearPropertySlug = '';
  let cheapUnitId = '';
  let secondUnitId = '';
  let partnerId = '';

  const query = (overrides: Partial<SearchQuery> = {}): SearchQuery => ({
    checkIn: isoDate(IN),
    checkOut: isoDate(OUT),
    adults: 2,
    children: 0,
    infants: 0,
    attributes: [],
    amenityCodes: [],
    freeCancellationOnly: false,
    sort: 'recommended',
    limit: 20,
    citySlug,
    ...overrides,
  });

  /** Slugs found by a search, in result order. */
  const slugs = async (overrides: Partial<SearchQuery> = {}): Promise<string[]> =>
    (await search.search(query(overrides))).items.map((item) => item.slug);

  beforeEach(async () => {
    await harness.begin();
    await seed();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  // ─── What is bookable ──────────────────────────────────────────────────────

  it('returns published properties that have a unit free for the dates', async () => {
    const found = await slugs();

    expect(found).toContain(cheapPropertySlug);
    expect(found).toContain(dearPropertySlug);
  });

  it('gives one row per property, not one per unit', async () => {
    const found = await slugs();

    expect(new Set(found).size).toBe(found.length);
  });

  it('represents a property by its CHEAPEST bookable unit', async () => {
    const result = await search.search(query());
    const cheap = result.items.find((item) => item.slug === cheapPropertySlug);

    /* Two units, 100 and 250 a night; the search must quote the 100 one. */
    expect(cheap?.unitId).toBe(cheapUnitId);
    expect(cheap?.stayTotal).toBe('200.000');
  });

  it('excludes a unit whose days are closed in the range', async () => {
    await db.execute(sql`
      INSERT INTO availability_days (unit_id, date, status)
      VALUES (${cheapUnitId}::uuid, ${isoDate(IN)}::date, 'closed')
      ON CONFLICT (unit_id, date) DO UPDATE SET status = 'closed'
    `);

    const result = await search.search(query());
    const cheap = result.items.find((item) => item.slug === cheapPropertySlug);

    /* The property survives on its OTHER unit, at the higher price. */
    expect(cheap?.unitId).toBe(secondUnitId);
  });

  it('excludes a unit with an overlapping live booking', async () => {
    await bookOut(cheapUnitId, 'confirmed');

    const result = await search.search(query());

    expect(result.items.find((item) => item.slug === cheapPropertySlug)?.unitId).toBe(
      secondUnitId,
    );
  });

  it('ignores a CANCELLED booking, which frees the night again', async () => {
    await bookOut(cheapUnitId, 'cancelled');

    const result = await search.search(query());

    expect(result.items.find((item) => item.slug === cheapPropertySlug)?.unitId).toBe(
      cheapUnitId,
    );
  });

  it('excludes a unit that cannot hold the party', async () => {
    const found = await slugs({ adults: 8 });

    /* Only the dear property has a unit for eight. */
    expect(found).not.toContain(cheapPropertySlug);
    expect(found).toContain(dearPropertySlug);
  });

  it('honours a per-day minimum-nights override on the arrival date', async () => {
    await db.execute(sql`
      INSERT INTO availability_days (unit_id, date, status, min_nights)
      VALUES (${cheapUnitId}::uuid, ${isoDate(IN)}::date, 'available', 5)
      ON CONFLICT (unit_id, date) DO UPDATE SET min_nights = 5
    `);

    const result = await search.search(query());

    expect(result.items.find((item) => item.slug === cheapPropertySlug)?.unitId).toBe(
      secondUnitId,
    );
  });

  /**
   * A minimum-nights override binds on the ARRIVAL day only.
   *
   * The rule and the closed-day rule now share one scan of the same date range, so this is the edge
   * that merging them could have broken: an override sitting on a later night of the stay must not
   * exclude the unit, because the guest is not arriving then.
   */
  it('ignores a minimum-nights override on a night that is not the arrival', async () => {
    await db.execute(sql`
      INSERT INTO availability_days (unit_id, date, status, min_nights)
      VALUES (${cheapUnitId}::uuid, ${isoDate(IN + 1)}::date, 'available', 30)
      ON CONFLICT (unit_id, date) DO UPDATE SET min_nights = 30
    `);

    const result = await search.search(query());

    expect(result.items.find((item) => item.slug === cheapPropertySlug)?.unitId).toBe(
      cheapUnitId,
    );
  });

  // ─── What a stay costs ─────────────────────────────────────────────────────

  /**
   * The pricing rule, and the one the rewrite had to preserve exactly: a per-day override wins over
   * the unit's base price, and days with no row fall back to it. Two nights, one of them priced.
   */
  it('sums per-night overrides and falls back to the base price', async () => {
    await db.execute(sql`
      INSERT INTO availability_days (unit_id, date, status, price)
      VALUES (${cheapUnitId}::uuid, ${isoDate(IN)}::date, 'available', '175.00')
      ON CONFLICT (unit_id, date) DO UPDATE SET price = '175.00'
    `);

    const result = await search.search(query());
    const cheap = result.items.find((item) => item.slug === cheapPropertySlug);

    /* 175 for the overridden night + 100 for the plain one. */
    expect(cheap?.stayTotal).toBe('275.000');
    expect(cheap?.nightlyFrom).toBe('137.50');
  });

  /** A row that exists for its STATUS but carries no price must not be read as free. */
  it('treats a priceless availability row as the base price, not as zero', async () => {
    await db.execute(sql`
      INSERT INTO availability_days (unit_id, date, status, price)
      VALUES (${cheapUnitId}::uuid, ${isoDate(IN)}::date, 'available', NULL)
      ON CONFLICT (unit_id, date) DO UPDATE SET price = NULL
    `);

    const result = await search.search(query());

    expect(result.items.find((item) => item.slug === cheapPropertySlug)?.stayTotal).toBe(
      '200.000',
    );
  });

  /** Only the nights INSIDE the stay count — the checkout day is not slept in. */
  it('prices the arrival night and not the departure day', async () => {
    await db.execute(sql`
      INSERT INTO availability_days (unit_id, date, status, price)
      VALUES (${cheapUnitId}::uuid, ${isoDate(OUT)}::date, 'available', '900.00')
      ON CONFLICT (unit_id, date) DO UPDATE SET price = '900.00'
    `);

    const result = await search.search(query());

    expect(result.items.find((item) => item.slug === cheapPropertySlug)?.stayTotal).toBe(
      '200.000',
    );
  });

  it('reports the number of nights it priced', async () => {
    const result = await search.search(query());

    expect(result.items[0]?.nights).toBe(2);
  });

  // ─── Filters ───────────────────────────────────────────────────────────────

  it('filters by city', async () => {
    const elsewhere = await slugs({ citySlug: 'damascus' });

    expect(elsewhere).not.toContain(cheapPropertySlug);
  });

  it('filters by property type', async () => {
    const hotels = await slugs({ propertyTypeCode: 'hotel' });
    const villas = await slugs({ propertyTypeCode: 'villa' });

    expect(hotels).toContain(cheapPropertySlug);
    expect(hotels).not.toContain(dearPropertySlug);
    expect(villas).toContain(dearPropertySlug);
  });

  it('filters by the price of the STAY, not the nightly rate', async () => {
    const upTo = await slugs({ maxPrice: 250 });

    /* 2 × 100 = 200 is in; 2 × 400 = 800 is out. */
    expect(upTo).toContain(cheapPropertySlug);
    expect(upTo).not.toContain(dearPropertySlug);

    /* Both of the cheap property's units are under 600, so it drops out entirely. */
    const from = await slugs({ minPrice: 600 });

    expect(from).not.toContain(cheapPropertySlug);
    expect(from).toContain(dearPropertySlug);
  });

  /**
   * The price filter chooses a QUALIFYING unit rather than judging the property on its cheapest.
   *
   * A property whose cheapest room is below the floor still appears if a dearer room clears it, and
   * it is then quoted at that room's price. Surprising written down, right for a guest who asked for
   * a minimum, and easy to break by moving the filter — which is why it is pinned here.
   */
  it('quotes a dearer unit when the cheapest one falls below the price floor', async () => {
    const result = await search.search(query({ minPrice: 500 }));
    const cheap = result.items.find((item) => item.slug === cheapPropertySlug);

    expect(cheap?.unitId).toBe(secondUnitId);
    expect(cheap?.stayTotal).toBe('500.000');
  });

  it('filters on trip attributes, requiring ALL of them', async () => {
    const both = await slugs({ attributes: ['families', 'sea'] });
    const one = await slugs({ attributes: ['families'] });

    expect(one).toContain(cheapPropertySlug);
    /* The cheap property carries `family` only, so demanding both must drop it. */
    expect(both).not.toContain(cheapPropertySlug);
  });

  // ─── Order ─────────────────────────────────────────────────────────────────

  /** §5.5: the default is what SAFRA recommends, NOT the cheapest. */
  it('defaults to recommendation order rather than price', async () => {
    const found = await slugs({ sort: 'recommended' });

    /* The dear property scores higher, so it leads despite costing four times as much. */
    expect(found.indexOf(dearPropertySlug)).toBeLessThan(
      found.indexOf(cheapPropertySlug),
    );
  });

  it('sorts by price in both directions when asked', async () => {
    const ascending = await slugs({ sort: 'price_asc' });
    const descending = await slugs({ sort: 'price_desc' });

    expect(ascending.indexOf(cheapPropertySlug)).toBeLessThan(
      ascending.indexOf(dearPropertySlug),
    );
    expect(descending.indexOf(dearPropertySlug)).toBeLessThan(
      descending.indexOf(cheapPropertySlug),
    );
  });

  it('sorts by rating when asked', async () => {
    const found = await slugs({ sort: 'rating_desc' });

    expect(found.indexOf(dearPropertySlug)).toBeLessThan(
      found.indexOf(cheapPropertySlug),
    );
  });

  // ─── The two query shapes must agree ───────────────────────────────────────

  /**
   * The most important test in this file.
   *
   * `recommended` and `rating_desc` with no price filter take a FAST PATH: the page's properties are
   * chosen by rank before anything is priced, so twenty properties are priced instead of fifty
   * thousand. Any other combination prices everything and sorts afterwards.
   *
   * Two code paths answering one question is a correctness risk, and the only way to hold them
   * together is to ask the same question both ways. `maxPrice` far above every fixture price cannot
   * change WHICH properties match — it only disqualifies the fast path — so the two results must be
   * identical, in the same order.
   */
  it('returns identical results whether or not the pre-pricing fast path is used', async () => {
    for (const sort of ['recommended', 'rating_desc'] as const) {
      const fast = await search.search(query({ sort }));
      /* Same query, same matches, slow path — a ceiling nothing here comes close to. */
      const slow = await search.search(query({ sort, maxPrice: 1_000_000 }));

      expect(
        slow.items.map((item) => item.slug),
        sort,
      ).toStrictEqual(fast.items.map((item) => item.slug));
      expect(
        slow.items.map((item) => item.stayTotal),
        sort,
      ).toStrictEqual(fast.items.map((item) => item.stayTotal));
      expect(
        slow.items.map((item) => item.unitId),
        sort,
      ).toStrictEqual(fast.items.map((item) => item.unitId));
    }
  });

  /**
   * Ties at the page boundary, which is why the fast path ranks with `RANK()` and not `ROW_NUMBER()`.
   *
   * Three properties share one recommendation score and one rating, so their order is decided by the
   * third key — the price — which the fast path has not computed when it chooses the page. `RANK()`
   * gives tied rows the same rank, so asking for one row still admits all three to be priced, and the
   * cheapest wins. `ROW_NUMBER()` would have cut two of them off arbitrarily and returned whichever
   * the scan happened to reach first.
   */
  it('picks the right row when the whole page is tied on score and rating', async () => {
    /* Level the fixtures, then add a third property cheaper than both. */
    await db.execute(sql`
      UPDATE properties SET recommendation_score = '7.000', rating = '4.0'
      WHERE slug IN (${cheapPropertySlug}, ${dearPropertySlug})
    `);

    const third = await db.execute<{ slug: string }>(sql`
      WITH pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status,
                                rating, recommendation_score)
        SELECT ${partnerId}::uuid, p.city_id, p.property_type_id, p.cancellation_policy_id,
               'search-tied-' || substr(gen_random_uuid()::text, 1, 8),
               'ثالث', 'Third', 'Dritte', 'x', 'published', '4.0', '7.000'
        FROM properties p WHERE p.slug = ${cheapPropertySlug}
        RETURNING id, slug
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id, min_nights, is_active)
        SELECT pr.id, 'و', 'U', 'E', 2, '10.00', u.currency_id, 1, true
        FROM pr, units u WHERE u.id = ${cheapUnitId}::uuid
        RETURNING id
      )
      SELECT pr.slug FROM pr, un
    `);

    const cheapest = third.rows[0]?.slug;

    /* All three tie on (score, rating); the 10-a-night one is cheapest, so it must lead. */
    const page = await search.search(query({ limit: 1 }));

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.slug).toBe(cheapest);
  });

  // ─── Paging ────────────────────────────────────────────────────────────────

  it('pages without repeating a property, and stops', async () => {
    const first = await search.search(query({ limit: 1 }));

    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();

    const second = await search.search(
      query({ limit: 1, cursor: first.nextCursor ?? undefined }),
    );

    const seen = [...first.items, ...second.items].map((item) => item.slug);

    expect(new Set(seen).size).toBe(2);
  });

  it('refuses a forged cursor', async () => {
    await expect(search.search(query({ cursor: 'not-a-cursor' }))).rejects.toMatchObject({
      status: 400,
    });
  });

  // ─── The shape the customer app depends on ─────────────────────────────────

  /**
   * All three names, for the property and the city.
   *
   * The projection once carried Arabic and English only, and a German reader got the ENGLISH name
   * and the city SLUG. The comment on `SearchResultItem` records it; this checks it.
   */
  it('carries every localised name the three locales need', async () => {
    const item = (await search.search(query())).items[0];

    expect(item?.nameAr).toBeTruthy();
    expect(item?.nameEn).toBeTruthy();
    expect(item?.nameDe).toBeTruthy();
    expect(item?.cityNameAr).toBeTruthy();
    expect(item?.cityNameEn).toBeTruthy();
    expect(item?.cityNameDe).toBeTruthy();
  });

  it('does not leak the columns that exist only to drive ORDER BY', async () => {
    const item = (await search.search(query())).items[0] as unknown as Record<
      string,
      unknown
    >;

    expect(item['row_no']).toBeUndefined();
    expect(item['recommendation_score']).toBeUndefined();
    expect(item['stay_total_sort']).toBeUndefined();
  });

  /** Takes a unit out of the running by booking it for the whole range. */
  async function bookOut(unitId: string, status: string): Promise<void> {
    await db.execute(sql`
      INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                            check_in, check_out, guests_adults, status,
                            base_amount, customer_fee_value, customer_fee_amount,
                            partner_commission_rate, partner_commission_amount,
                            total_amount, partner_payable_amount, currency_id,
                            fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
      SELECT cp.id, u.id, u.property_id, ${partnerId}::uuid, p.city_id,
             ${isoDate(IN)}::date, ${isoDate(OUT)}::date, 2, ${status}::booking_status,
             '200.000', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
             u.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
      FROM units u
      JOIN properties p ON p.id = u.property_id
      CROSS JOIN LATERAL (
        SELECT id FROM customer_profiles ORDER BY created_at LIMIT 1
      ) cp
      WHERE u.id = ${unitId}::uuid
    `);
  }

  /**
   * Two properties in a city of their own.
   *
   * The city is created here rather than reused, so the assertions are about these fixtures and not
   * about whatever else the development database happens to hold.
   */
  async function seed(): Promise<void> {
    const made = await db.execute<{
      city_slug: string;
      partner_id: string;
      cheap_slug: string;
      dear_slug: string;
      cheap_unit: string;
      second_unit: string;
      dear_unit: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM countries LIMIT 1)                        AS country_id,
               (SELECT id FROM currencies WHERE code = 'USD')            AS currency_id,
               (SELECT id FROM property_types WHERE code = 'hotel')      AS hotel_id,
               (SELECT id FROM property_types WHERE code = 'villa')      AS villa_id,
               (SELECT id FROM cancellation_policies ORDER BY code LIMIT 1) AS policy_id,
               (SELECT id FROM partner_types LIMIT 1)                    AS partner_type_id
      ), ci AS (
        INSERT INTO cities (country_id, slug, name_ar, name_en, name_de, timezone, is_active)
        SELECT ref.country_id, 'search-city-' || substr(gen_random_uuid()::text, 1, 8),
               'مدينة', 'City', 'Stadt', 'Asia/Damascus', true
        FROM ref RETURNING id, slug
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('search-partner-' || gen_random_uuid() || '@safra.test', '+963900000070',
                'partner', 'active')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Search', 'بحث', ci.id, 'x', '+963900000070',
               'search-partner-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref, ci RETURNING id
      ), cheap AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status,
                                rating, recommendation_score, attributes)
        SELECT pa.id, ci.id, ref.hotel_id, ref.policy_id,
               'search-cheap-' || substr(gen_random_uuid()::text, 1, 8),
               'رخيص', 'Cheap', 'Guenstig', 'x', 'published',
               '3.0', '5.000', ARRAY['families']
        FROM pa, ci, ref RETURNING id, slug
      ), dear AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status,
                                rating, recommendation_score, attributes)
        SELECT pa.id, ci.id, ref.villa_id, ref.policy_id,
               'search-dear-' || substr(gen_random_uuid()::text, 1, 8),
               'غالي', 'Dear', 'Teuer', 'x', 'published',
               '4.8', '9.000', ARRAY['families', 'sea']
        FROM pa, ci, ref RETURNING id, slug
      ), u1 AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id, min_nights, is_active)
        SELECT cheap.id, 'وحدة', 'Unit', 'Einheit', 2, '100.00', ref.currency_id, 1, true
        FROM cheap, ref RETURNING id
      ), u2 AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id, min_nights, is_active)
        SELECT cheap.id, 'وحدة٢', 'Unit 2', 'Einheit 2', 2, '250.00', ref.currency_id, 1, true
        FROM cheap, ref RETURNING id
      ), u3 AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id, min_nights, is_active)
        SELECT dear.id, 'فيلا', 'Villa', 'Villa', 10, '400.00', ref.currency_id, 1, true
        FROM dear, ref RETURNING id
      )
      SELECT ci.slug AS city_slug, pa.id AS partner_id,
             cheap.slug AS cheap_slug, dear.slug AS dear_slug,
             u1.id AS cheap_unit, u2.id AS second_unit, u3.id AS dear_unit
      FROM ci, pa, cheap, dear, u1, u2, u3
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    citySlug = row.city_slug;
    partnerId = row.partner_id;
    cheapPropertySlug = row.cheap_slug;
    dearPropertySlug = row.dear_slug;
    cheapUnitId = row.cheap_unit;
    secondUnitId = row.second_unit;
  }
});
