import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AdDeliveryService } from './ad-delivery.service.js';

/**
 * What a customer is shown, and what they are never shown.
 *
 * ## The rules this holds are the ones an advertiser is paying for
 *
 * A campaign that is paused, in draft, in another city, or past its window must not be delivered —
 * each for a different reason, and each is somebody's money. Serving a lapsed campaign hands an
 * advertiser impressions they stopped paying for; failing to serve a live one is placement they
 * DID pay for and did not receive.
 *
 * The window is decided against the CLOCK rather than the status column, so the hour between a
 * campaign lapsing and the sweep retiring it delivers nothing. That was the defect on this page.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('what the customer app is served', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const delivery = new AdDeliveryService(db);

  let citySlug = '';
  let otherSlug = '';

  /**
   * Two cities of this test's OWN, created inside the rolled-back transaction.
   *
   * This used to take the first two real cities and `DELETE FROM ad_campaigns` to make a count
   * mean something. Two things were wrong with that. It broke the moment `ad_invoices` gained a
   * foreign key to `ad_campaigns` — a real campaign with a real invoice cannot be deleted, and the
   * whole file failed on the DELETE rather than on anything it was measuring. And before that it
   * had been passing for the wrong reason: every assertion here counted rows in a table the test
   * had just emptied, so «serves ONE campaign» proved nothing about scoping.
   *
   * A slug nothing else uses is the honest fixture. `forCity` keys on it, so what comes back is
   * what this test made — whatever else the database holds.
   */
  async function makeCity(label: string): Promise<string> {
    const slug = `ad-test-${label}-${globalThis.crypto.randomUUID()}`;

    await db.execute(sql`
      INSERT INTO cities (country_id, slug, name_ar, name_en, name_de, timezone)
      SELECT id, ${slug}, 'مدينة اختبار', 'Test City', 'Teststadt', 'Asia/Damascus'
      FROM countries ORDER BY id LIMIT 1
    `);

    return slug;
  }

  beforeEach(async () => {
    await harness.begin();

    citySlug = await makeCity('own');
    otherSlug = await makeCity('other');
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  async function campaign(over: Record<string, unknown> = {}): Promise<string> {
    const v = {
      status: 'active',
      starts: -1,
      ends: 30,
      slug: citySlug,
      headline_ar: 'مطعم الشام',
      headline_en: 'Sham Restaurant',
      headline_de: 'Restaurant Sham',
      target: 'https://example.test/menu',
      ...over,
    };

    const made = await db.execute<{ reference: string }>(sql`
      WITH adv AS (
        INSERT INTO advertisers (name, kind, city_id)
        SELECT 'مطعم الشام', 'restaurant', id FROM cities WHERE slug = ${v.slug}
        RETURNING id
      )
      INSERT INTO ad_campaigns (advertiser_id, city_id, status, starts_at, ends_at,
                                headline_ar, headline_en, headline_de, target_url)
      SELECT adv.id, (SELECT id FROM cities WHERE slug = ${v.slug}), ${v.status}::ad_status,
             now() + (${v.starts} * interval '1 day'),
             now() + (${v.ends} * interval '1 day'),
             ${v.headline_ar}, ${v.headline_en}, ${v.headline_de}, ${v.target}
      FROM adv
      RETURNING reference
    `);

    return made.rows[0]?.reference ?? '';
  }

  it('serves a live campaign for its own city', async () => {
    await campaign();

    const served = await delivery.forCity(citySlug, 'ar');

    expect(served).toHaveLength(1);
    expect(served[0]?.headline).toBe('مطعم الشام');
    /* The click goes through SAFRA, never straight to the advertiser. */
    expect(served[0]?.clickPath).toMatch(/^\/api\/v1\/ads\/ADS-[\w-]+\/click$/);
  });

  /** In the reader's own language — three columns exist precisely so this is possible. */
  it('serves the headline in the reader’s language', async () => {
    await campaign();

    expect((await delivery.forCity(citySlug, 'en'))[0]?.headline).toBe('Sham Restaurant');
    expect((await delivery.forCity(citySlug, 'de'))[0]?.headline).toBe('Restaurant Sham');
  });

  /**
   * Four campaigns that must never be served, each for its own reason.
   *
   * Asserted together with a live one present, so «nothing was served» cannot pass for «the right
   * thing was withheld» — the control this suite would be worthless without.
   */
  it('never serves a draft, a paused, a lapsed or another city’s campaign', async () => {
    await campaign({ status: 'draft' });
    await campaign({ status: 'paused' });
    await campaign({ starts: -40, ends: -1 });
    await campaign({ slug: otherSlug });

    expect(await delivery.forCity(citySlug, 'ar'), 'none of the four').toHaveLength(0);

    /* The control: a live one in this city IS served, so the filter is not simply refusing all. */
    await campaign();

    expect(await delivery.forCity(citySlug, 'ar')).toHaveLength(1);
  });

  /**
   * A campaign whose window has closed but which the sweep has not reached is NOT served.
   *
   * Its column still says `active`. This is the defect the whole page turned on, at the surface
   * where it costs an advertiser money.
   */
  it('withholds a lapsed campaign the sweep has not retired yet', async () => {
    const reference = await campaign({ ends: 30 });

    await db.execute(sql`
      UPDATE ad_campaigns SET ends_at = now() - interval '1 minute' WHERE reference = ${reference}
    `);

    const stored = await db.execute<{ status: string }>(sql`
      SELECT status::text AS status FROM ad_campaigns WHERE reference = ${reference}
    `);

    expect(stored.rows[0]?.status, 'the column has not caught up').toBe('active');
    expect(
      await delivery.forCity(citySlug, 'ar'),
      'and it is still withheld',
    ).toHaveLength(0);
  });

  /** Impressions are counted from what was actually returned, server-side. */
  it('counts an impression for each ad it served', async () => {
    const reference = await campaign();

    await delivery.forCity(citySlug, 'ar');
    await delivery.forCity(citySlug, 'ar');

    const counted = await db.execute<{ impressions: number }>(sql`
      SELECT impressions FROM ad_campaigns WHERE reference = ${reference}
    `);

    expect(Number(counted.rows[0]?.impressions)).toBe(2);
  });

  /**
   * A click counts, and answers the advertiser's own URL — from the row, never the request.
   *
   * The ad is SERVED first, because `ad_campaigns_clicks_within_impressions` refuses a click that
   * would exceed the campaign's impressions. That constraint is right — you cannot click what you
   * were never shown — and writing this test without the impression is how I found it.
   */
  it('counts a click and answers where to go', async () => {
    const reference = await campaign();

    await delivery.forCity(citySlug, 'ar');

    expect(await delivery.click(reference)).toBe('https://example.test/menu');

    const counted = await db.execute<{ clicks: number }>(sql`
      SELECT clicks FROM ad_campaigns WHERE reference = ${reference}
    `);

    expect(Number(counted.rows[0]?.clicks)).toBe(1);
  });

  /**
   * A click with no impression behind it is refused by the DATABASE, and the customer still moves.
   *
   * `ad_campaigns_clicks_within_impressions` is the guard — a bookmarked click URL or a page
   * restored from history days later would otherwise inflate a figure the advertiser pays against.
   * The redirect still answers: failing somebody's navigation over a counter would be the larger
   * wrong, and the loss is logged with the reference rather than swallowed silently.
   */
  it('still sends the customer on when the click cannot be counted', async () => {
    const reference = await campaign();

    /* No `forCity` call, so impressions are 0 and the increment cannot be written. */
    expect(await delivery.click(reference)).toBe('https://example.test/menu');

    const counted = await db.execute<{ clicks: number; impressions: number }>(sql`
      SELECT clicks, impressions FROM ad_campaigns WHERE reference = ${reference}
    `);

    expect(Number(counted.rows[0]?.clicks), 'the invariant held').toBe(0);
    expect(Number(counted.rows[0]?.impressions)).toBe(0);
  });

  /**
   * A click on a campaign that is no longer live goes nowhere.
   *
   * Somebody with a stale page open must not deliver traffic the advertiser stopped paying for —
   * and a 404 is also what stops this endpoint being a general-purpose redirector.
   */
  it('refuses a click on a campaign that is not live', async () => {
    const paused = await campaign({ status: 'paused' });

    await expect(delivery.click(paused)).rejects.toMatchObject({
      response: { code: ERROR.CAMPAIGN_NOT_FOUND },
    });
  });
});
