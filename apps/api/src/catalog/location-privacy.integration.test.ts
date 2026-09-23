import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PUBLIC_COORDINATE_DECIMALS,
  PUBLIC_DISTANCE_STEP_METRES,
  distanceMetres,
  publicDistanceMetres,
} from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { NearbyService } from './nearby.service.js';
import { PropertyDetailService } from './property-detail.service.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * The location-privacy model, against a real PostgreSQL.
 *
 * ## What is actually at risk here
 *
 * A listing's exact position is protected by ONE thing: it is never sent. The map features
 * added on 2026-09-23 put three new numbers next to it — a distance to a landmark, a
 * neighbour's marker, a «within N km» filter — and each is a way to leak the same secret
 * without ever printing a coordinate.
 *
 * The sharp one is trilateration. Distances are not opinions: three accurate ones to three
 * known points locate a building to metres. So the property of interest is not «the distance
 * looks about right», it is **the published distance must be exactly reproducible from the
 * published coordinates** — because then it is a function of what the reader already has and
 * conveys nothing further, however many of them are collected.
 *
 * Each test below was watched to FAIL against the defect it describes; the mutations are
 * named in the comments so the next person can repeat them.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('location privacy', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const details = new PropertyDetailService(db, new SettingsService(db));
  const nearby = new NearbyService(db);

  beforeEach(async () => {
    await harness.begin();
  });
  afterEach(async () => {
    await harness.rollback();
  });
  afterAll(async () => {
    await harness.close();
  });

  /**
   * A published listing whose RAW coordinate is finer than the public one.
   *
   * The fineness is part of the fixture, not a convenience: a listing already stored at three
   * decimals would satisfy every assertion below no matter what the code did, which is the
   * «fixture that cannot reach the field it protects» failure `.claude/CLAUDE.md` names.
   */
  async function aPlacedListing(): Promise<{
    slug: string;
    rawLatitude: string;
    rawLongitude: string;
  }> {
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT slug, latitude, longitude FROM properties
      WHERE status = 'published' AND deleted_at IS NULL
        AND public_latitude IS NOT NULL
        AND latitude ~ '^-?[0-9]+[.][0-9]{4,}$'
      ORDER BY slug LIMIT 1
    `);
    const r = rows.rows[0];
    /*
      THROWS rather than returning null, and that is the point. Every test below used to
      early-return when the fixture was missing, so an empty database made the whole file
      pass in 145ms while asserting nothing — the «fixture that cannot reach the field it
      protects» failure, which reports coverage it does not have.
    */
    if (!r) {
      throw new Error(
        'No published listing has a raw coordinate finer than the public one. ' +
          'These tests cannot tell a leak from a coincidence without one — seed the demo data.',
      );
    }
    return {
      slug: String(r['slug']),
      rawLatitude: String(r['latitude']),
      rawLongitude: String(r['longitude']),
    };
  }

  it('publishes a coordinate no finer than the rounding promises', async () => {
    const listing = await aPlacedListing();

    const payload = await details.bySlug(listing.slug);

    expect(payload.latitude).not.toBe(listing.rawLatitude);
    expect(payload.longitude).not.toBe(listing.rawLongitude);
    expect(payload.latitude?.split('.')[1]).toHaveLength(PUBLIC_COORDINATE_DECIMALS);
    expect(payload.longitude?.split('.')[1]).toHaveLength(PUBLIC_COORDINATE_DECIMALS);
  });

  /**
   * The trilateration defence, stated as an equation.
   *
   * Mutated to prove it bites: point the landmarks query at `p.latitude` instead of
   * `p.public_latitude` and every distance shifts, which this catches on the first landmark.
   */
  it('publishes only distances the reader could compute from the coordinates given', async () => {
    const listing = await aPlacedListing();

    const payload = await details.bySlug(listing.slug);
    expect(payload.landmarks.length).toBeGreaterThan(0);

    const marks = await db.execute<Record<string, unknown>>(sql`
      SELECT slug, latitude, longitude FROM landmarks WHERE is_active AND deleted_at IS NULL
    `);
    const bySlug = new Map(
      marks.rows.map((m) => [
        String(m['slug']),
        { lat: Number(m['latitude']), lon: Number(m['longitude']) },
      ]),
    );

    for (const entry of payload.landmarks) {
      const mark = bySlug.get(String(entry.slug));
      expect(mark, `landmark ${String(entry.slug)} is missing`).toBeDefined();
      if (!mark) continue;

      /* Recomputed from the PUBLISHED pair only — the reader's own view of the world. */
      const derivable = publicDistanceMetres(
        Number(payload.latitude),
        Number(payload.longitude),
        mark.lat,
        mark.lon,
      );
      expect(entry.distanceMetres).toBe(derivable);

      /*
        Sanity, not secrecy: the published figure must still describe reality within about
        one rounding step, or the feature is private and useless.
      */
      const truth = distanceMetres(
        Number(listing.rawLatitude),
        Number(listing.rawLongitude),
        mark.lat,
        mark.lon,
      );
      expect(Math.abs(truth - entry.distanceMetres)).toBeLessThan(
        PUBLIC_DISTANCE_STEP_METRES * 2,
      );
    }
  });

  it('rounds every published distance to the step, never finer', async () => {
    const listing = await aPlacedListing();
    const payload = await details.bySlug(listing.slug);

    expect(payload.landmarks.length).toBeGreaterThan(0);
    for (const entry of payload.landmarks) {
      expect(entry.distanceMetres % PUBLIC_DISTANCE_STEP_METRES).toBe(0);
    }
  });

  /**
   * The general question, not «is this particular field absent».
   *
   * A test that says `not.toContain(rawLatitude)` protects the string it names and nothing
   * else — the lesson `.claude/CLAUDE.md` records from a privacy assertion that stayed green
   * while a full name started shipping beside the email it guarded. So this walks EVERY
   * value in the payload and fails on any that resolves the true position.
   */
  it('puts no value anywhere in the payload that resolves the exact location', async () => {
    const listing = await aPlacedListing();

    const payload = await details.bySlug(listing.slug);
    const trueLat = Number(listing.rawLatitude);
    const trueLon = Number(listing.rawLongitude);
    /* Closer than a quarter of the rounding step could not have come from the public pair. */
    const tooClose = 0.25 * 10 ** -PUBLIC_COORDINATE_DECIMALS;

    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (node === null || node === undefined) return;
      if (typeof node === 'object') {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          walk(v, `${path}.${k}`);
        }
        return;
      }
      if (typeof node !== 'string' && typeof node !== 'number') return;
      if (String(node) === payload.latitude || String(node) === payload.longitude) return;

      const asNumber = Number(node);
      if (!Number.isFinite(asNumber)) return;
      if (
        Math.abs(asNumber - trueLat) < tooClose ||
        Math.abs(asNumber - trueLon) < tooClose
      ) {
        offenders.push(`${path} = ${String(node)}`);
      }
    };
    walk(payload, 'payload');

    expect(
      offenders,
      `these resolve the exact position: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  /**
   * Neighbours are published at THEIR public precision.
   *
   * Mutated by selecting `p.latitude` in `nearby.service.ts`: the decimal-count assertion
   * fails on the first neighbour that has a finer raw value.
   */
  it('gives every neighbour the same rounding as its own property page', async () => {
    const listing = await aPlacedListing();

    const here = await details.publicLocation(listing.slug);
    expect(here).not.toBeNull();
    if (!here) throw new Error('a published listing must have a public location');

    const neighbours = await nearby.around(here.latitude, here.longitude, listing.slug);

    for (const n of neighbours) {
      expect(n.slug).not.toBe(listing.slug);
      if (n.latitude === null || n.longitude === null) continue;
      expect(n.latitude.split('.')[1]).toHaveLength(PUBLIC_COORDINATE_DECIMALS);
      expect(n.longitude.split('.')[1]).toHaveLength(PUBLIC_COORDINATE_DECIMALS);
    }
  });

  /**
   * A draft listing is not a neighbour.
   *
   * ## The fixture is PLANTED, and it has to be
   *
   * Written first as «read the neighbours, assert each is published», it passed against a
   * mutation that deleted the `status = 'published'` predicate outright. The database held
   * sixty drafts inside the search box — but the query returns the twelve NEAREST, and those
   * twelve happened to be published, so the defect was real and invisible.
   *
   * So the draft is planted at the exact centre, closer than anything else can be. If the
   * filter goes, this row is the first result rather than a row somewhere past the limit.
   * The published twin beside it is the control: it proves the planted row is reachable, so
   * a failure to see the draft means the filter worked rather than that the fixture was out
   * of range.
   */
  it('never offers a neighbour that is not published', async () => {
    const listing = await aPlacedListing();
    const here = await details.publicLocation(listing.slug);
    if (!here) throw new Error('a published listing must have a public location');

    const template = await db.execute<Record<string, unknown>>(sql`
      SELECT partner_id, city_id, property_type_id, cancellation_policy_id
      FROM properties WHERE slug = ${listing.slug} LIMIT 1
    `);
    const t = template.rows[0];
    if (!t) throw new Error('the fixture listing vanished');

    const plant = async (slug: string, status: string) => {
      await db.execute(sql`
        INSERT INTO properties
          (partner_id, city_id, property_type_id, cancellation_policy_id,
           slug, name_ar, name_en, name_de, address, latitude, longitude, status)
        VALUES
          (${t['partner_id']}, ${t['city_id']}, ${t['property_type_id']},
           ${t['cancellation_policy_id']},
           ${slug}, ${slug}, ${slug}, ${slug}, 'planted',
           ${here.latitude}, ${here.longitude}, ${status})
      `);
    };

    await plant('zz-privacy-probe-draft', 'draft');
    await plant('zz-privacy-probe-published', 'published');

    const neighbours = await nearby.around(here.latitude, here.longitude, listing.slug);
    const slugs = neighbours.map((n) => n.slug);

    /* The control: a published row planted at the same point IS returned. */
    expect(slugs, 'the planted rows are out of the query’s reach').toContain(
      'zz-privacy-probe-published',
    );
    /* The assertion: its draft twin, at the same point, is not. */
    expect(slugs).not.toContain('zz-privacy-probe-draft');

    /* And nothing else in the answer is unpublished either. */
    if (slugs.length === 0) return;
    const rows = await db.execute<{ slug: string; status: string }>(sql`
      SELECT slug, status FROM properties
      WHERE slug IN (${sql.join(
        slugs.map((one) => sql`${one}`),
        sql`, `,
      )})
    `);
    for (const r of rows.rows) expect(r.status).toBe('published');
  });

  /**
   * A listing that is not published has no public location.
   *
   * With the opposite control in the same test, because «withheld» and «absent» are
   * indistinguishable without one: a `publicLocation` that always returned null would pass
   * the second half and fail the first.
   */
  it('withholds a location for an unpublished listing, and grants one for a published listing', async () => {
    const placed = await aPlacedListing();

    expect(await details.publicLocation(placed.slug)).not.toBeNull();

    await db.execute(
      sql`UPDATE properties SET status = 'draft' WHERE slug = ${placed.slug}`,
    );
    expect(await details.publicLocation(placed.slug)).toBeNull();
  });
});
