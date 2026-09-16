import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import type { Env } from '../config/env.js';
import { PropertyMapService } from './property-map.service.js';

/**
 * Who can reach a listing's map, against a real PostgreSQL.
 *
 * The endpoint is `@Public()` and renders a paid third-party image, so the two questions
 * worth a database are: can it be pointed at inventory nobody is allowed to see, and can
 * it be pointed at somewhere we never agreed to pay for. Both are answered by the
 * service's `WHERE` clause, and a `WHERE` clause is exactly the thing a unit test with a
 * stubbed database cannot check.
 *
 * None of these cases reaches MapTiler: every one returns before `render()`, which is
 * what makes them safe to run in CI with no key and no network.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** A Redis that always misses, so the database is always consulted. */
const coldCache = {
  getBuffer: () => Promise.resolve(null),
  set: () => Promise.resolve('OK'),
} as unknown as ConstructorParameters<typeof PropertyMapService>[2];

const env = (key?: string) =>
  ({ MAPTILER_KEY: key, API_URL_SELF: 'http://localhost:4000' }) as unknown as Env;

describeIfDb('PropertyMapService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  beforeEach(async () => {
    await harness.begin();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  /** A listing in a given status, with or without coordinates. */
  async function makeProperty(options: {
    status: 'published' | 'draft';
    coordinates: boolean;
  }): Promise<string> {
    const email = `map-${crypto.randomUUID()}@safra.test`;
    const slug = `map-${crypto.randomUUID()}`;
    const latitude = options.coordinates ? '33.5138192' : null;
    const longitude = options.coordinates ? '36.2765401' : null;

    await db.execute(sql`
      WITH ci AS (SELECT id FROM cities LIMIT 1),
      u AS (
        INSERT INTO users (email, phone, role, status)
        VALUES (${email}, '+963900000411', 'partner', 'active') RETURNING id
      ), p AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT u.id, (SELECT id FROM partner_types LIMIT 1), 'Map', 'خريطة', ci.id,
               'x', '+963900000411', ${email}, 'approved'
        FROM u, ci RETURNING id
      )
      INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                              slug, name_ar, name_en, name_de, address, status,
                              latitude, longitude)
      SELECT p.id, ci.id, (SELECT id FROM property_types LIMIT 1),
             (SELECT id FROM cancellation_policies LIMIT 1),
             ${slug}, 'عقار', 'Prop', 'Prop', 'x', ${options.status}::property_status,
             ${latitude}, ${longitude}
      FROM p, ci
    `);

    return slug;
  }

  it('renders nothing when no MapTiler plan is configured', async () => {
    const service = new PropertyMapService(db, env(undefined), coldCache);
    const slug = await makeProperty({ status: 'published', coordinates: true });

    await expect(service.image(slug, 'card')).rejects.toMatchObject({ status: 404 });
  });

  /**
   * Runs one request with the network replaced, and reports whether MapTiler was reached.
   *
   * Asserting only that a refusal is a 404 proved nothing, and this is the whole reason
   * the helper exists: with `AND p.status = 'published'` deleted from the query, a draft
   * listing was still refused — by MAPTILER, which answered 403 to a key it did not
   * recognise, and the service turned that into the same 404. The test was green against
   * a service with no authorization at all. What actually distinguishes the two is
   * whether a paid request was SENT, so that is what these assert.
   */
  async function attempt(service: PropertyMapService, slug: string) {
    let upstreamUrl: string | null = null;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      upstreamUrl = input instanceof Request ? input.url : String(input);
      return Promise.reject(new Error('the network is blocked in this test'));
    };

    try {
      const error = await service.image(slug, 'card').catch((reason: unknown) => reason);
      return { error, upstreamUrl };
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  it('refuses an unpublished listing WITHOUT spending a MapTiler request', async () => {
    const service = new PropertyMapService(db, env('test-key'), coldCache);
    const draft = await makeProperty({ status: 'draft', coordinates: true });

    const { error, upstreamUrl } = await attempt(service, draft);

    expect(error).toMatchObject({ status: 404 });
    expect(upstreamUrl).toBeNull();
  });

  it('answers an unpublished listing exactly as it answers one that never existed', async () => {
    const service = new PropertyMapService(db, env('test-key'), coldCache);

    const draft = await attempt(
      service,
      await makeProperty({ status: 'draft', coordinates: true }),
    );
    const absent = await attempt(service, `map-${crypto.randomUUID()}`);

    expect(JSON.stringify(draft.error)).toBe(JSON.stringify(absent.error));
    expect(draft.upstreamUrl).toBeNull();
    expect(absent.upstreamUrl).toBeNull();
  });

  it('refuses a published listing that has no coordinates, also without a request', async () => {
    const service = new PropertyMapService(db, env('test-key'), coldCache);
    const slug = await makeProperty({ status: 'published', coordinates: false });

    const { error, upstreamUrl } = await attempt(service, slug);

    expect(error).toMatchObject({ status: 404 });
    expect(upstreamUrl).toBeNull();
  });

  it('DOES render for a published listing with coordinates, and asks for the right point', async () => {
    /*
      The opposite control. Without it every assertion above is satisfied by a service
      that refuses everything, which is the failure mode «Security tests need an opposite
      control» names.
    */
    const service = new PropertyMapService(db, env('test-key'), coldCache);
    const slug = await makeProperty({ status: 'published', coordinates: true });

    const { upstreamUrl } = await attempt(service, slug);

    expect(upstreamUrl).toContain('api.maptiler.com');
    // lon,lat — in that order, and rounded. Reversed would be the Indian Ocean.
    expect(upstreamUrl).toContain('36.277,33.514');
    expect(upstreamUrl).toContain('path=');
    // The raw coordinates must not survive into the request.
    expect(upstreamUrl).not.toContain('33.5138192');
    expect(upstreamUrl).not.toContain('36.2765401');
  });
});
