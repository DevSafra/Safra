import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR, PERMISSIONS as P } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { PropertiesService } from './properties.service.js';
import { AuditService } from '../common/audit/audit.service.js';

/**
 * The one structural field a PUBLISHED listing may still complete: a location it never had.
 *
 * ## What is being traded, and what is not
 *
 * §8.1 freezes a published listing's address, city and classification because SAFRA verified
 * them against each other; P-002 is the promise that «موثّق» means something. Coordinates sat
 * inside that freeze and the cost was measured on 2026-09-23: **67 of 2,017 published
 * listings had them**, so every map feature was dark for the rest and the only route to
 * fixing one was a support ticket.
 *
 * The exception is narrow and this file is what keeps it narrow:
 *
 * - SETTING a null location is not a change to anything verified. The address is unchanged
 *   and still checked; the partner is saying where that address already is.
 * - MOVING an existing one is a claim about a different place, and stays refused.
 * - CLEARING one is a change too, and stays refused.
 * - Nothing may ride along with it. A patch that also touches the address falls back to the
 *   ordinary rule, so the exception cannot be used to smuggle one through.
 *
 * Every case below was watched to FAIL against a mutation that widened the exception.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a published listing and its missing location', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  beforeEach(async () => {
    await harness.begin();
  });
  afterEach(async () => {
    await harness.rollback();
  });
  afterAll(async () => {
    await harness.close();
  });

  /** A published listing owned by a real partner, with its location cleared. */
  async function aPublishedListing(placed: boolean) {
    const rows = await db.execute<{
      reference: string;
      partner_id: string;
      user_id: string;
    }>(
      sql`
        SELECT p.reference, p.partner_id, pe.user_id
        FROM properties p
        JOIN partner_employees pe ON pe.partner_id = p.partner_id
        WHERE p.status = 'published' AND p.deleted_at IS NULL
          AND pe.status = 'active' 
        ORDER BY p.reference
        LIMIT 1
      `,
    );
    const row = rows.rows[0];
    if (!row) throw new Error('no published listing with an owning user to test against');

    await db.execute(sql`
      UPDATE properties
      SET latitude = ${placed ? '33.500000' : null},
          longitude = ${placed ? '36.300000' : null}
      WHERE reference = ${row.reference}
    `);

    return row;
  }

  /*
    `permissions`, not `capabilities`, and the constant rather than a hand-typed string.

    The first version guessed the key. `requirePartnerId` then threw PERMISSION_DENIED before
    the guard under test ran, and FOUR of these tests passed for that reason — green against
    code that could not possibly have been exercised. A refusal test that refuses for the
    wrong reason is the «control that changes nothing» this codebase has a rule about, so the
    happy-path test above is the one that keeps the others honest: it can only pass if the
    claims actually work.
  */
  /* A real AuditService over the same rolled-back connection — `update` records a trail. */
  const serviceFor = () => new PropertiesService(db, new AuditService(db));

  const claimsFor = (row: { user_id: string; partner_id: string }) =>
    ({
      sub: row.user_id,
      partnerId: row.partner_id,
      permissions: [P.PROPERTY_MANAGE_OWN],
    }) as never;

  it('lets a partner place a published listing that has no location', async () => {
    const row = await aPublishedListing(false);
    const service = serviceFor();

    await service.update(claimsFor(row), row.reference, {
      latitude: '33.514500',
      longitude: '36.299100',
    });

    const after = await db.execute<{ latitude: string; public_latitude: string }>(
      sql`SELECT latitude, public_latitude FROM properties WHERE reference = ${row.reference}`,
    );
    expect(after.rows[0]?.latitude).toBe('33.514500');
    /* And the PUBLIC pair follows automatically — the generated column, not a second write. */
    expect(after.rows[0]?.public_latitude).toBe('33.515');
  });

  /**
   * The control for the test above, and the half that protects P-002.
   *
   * Mutated by dropping `unplaced` from the condition in `update`: this goes green→red
   * immediately, which is what proves the exception is about a GAP rather than about
   * coordinates being exempt.
   */
  it('refuses to MOVE a published listing that already has one', async () => {
    const row = await aPublishedListing(true);
    const service = serviceFor();

    await expect(
      service.update(claimsFor(row), row.reference, {
        latitude: '35.000000',
        longitude: '38.000000',
      }),
    ).rejects.toThrow();

    const after = await db.execute<{ latitude: string }>(
      sql`SELECT latitude FROM properties WHERE reference = ${row.reference}`,
    );
    expect(after.rows[0]?.latitude).toBe('33.500000');
  });

  it('refuses to CLEAR a published listing’s location', async () => {
    const row = await aPublishedListing(true);
    const service = serviceFor();

    await expect(
      service.update(claimsFor(row), row.reference, {
        latitude: null,
        longitude: null,
      }),
    ).rejects.toThrow();
  });

  /**
   * HALF a pair is not a location, and this is what `settingNotClearing` actually guards.
   *
   * Written after a mutation survived: the «refuses to CLEAR» test above passes because the
   * listing is already PLACED, so `unplaced` refuses it and the clearing check is never
   * reached. Deleting that check changed nothing and every test stayed green — a guard with
   * no test is indistinguishable from a guard that does nothing.
   *
   * The reachable case is an unplaced listing given one coordinate and not the other. It
   * would leave a latitude with no longitude: `public_latitude IS NOT NULL` is the predicate
   * the neighbours query filters on, so the row enters that scan and is then dropped by a
   * NULL comparison — work done to return nothing, and a listing that reads as located to
   * anything checking one column.
   */
  it('refuses half a coordinate pair, which is not a location', async () => {
    const row = await aPublishedListing(false);
    const service = serviceFor();

    await expect(
      service.update(claimsFor(row), row.reference, {
        latitude: '33.514500',
        longitude: null,
      }),
    ).rejects.toThrow();

    const after = await db.execute<{ latitude: string | null }>(
      sql`SELECT latitude FROM properties WHERE reference = ${row.reference}`,
    );
    expect(after.rows[0]?.latitude).toBeNull();
  });

  /**
   * Nothing rides along.
   *
   * Mutated by relaxing `onlyCoordinates` to «includes a coordinate»: the address change
   * below then succeeds on a published listing, which is precisely what §8.1 forbids.
   */
  it('refuses a patch that carries an address change beside the location', async () => {
    const row = await aPublishedListing(false);
    const service = serviceFor();

    await expect(
      service.update(claimsFor(row), row.reference, {
        latitude: '33.514500',
        longitude: '36.299100',
        address: 'somewhere else entirely',
      }),
    ).rejects.toThrow();

    const after = await db.execute<{ latitude: string | null; address: string }>(
      sql`SELECT latitude, address FROM properties WHERE reference = ${row.reference}`,
    );
    /* Neither half landed — the whole patch is refused, not the offending key alone. */
    expect(after.rows[0]?.latitude).toBeNull();
    expect(after.rows[0]?.address).not.toBe('somewhere else entirely');
  });

  it('still refuses an ordinary structural change on a published listing', async () => {
    const row = await aPublishedListing(false);
    const service = serviceFor();

    await expect(
      service.update(claimsFor(row), row.reference, {
        address: 'a new address',
      }),
    ).rejects.toThrow(expect.objectContaining({ message: expect.anything() }));

    const after = await db.execute<{ address: string }>(
      sql`SELECT address FROM properties WHERE reference = ${row.reference}`,
    );
    expect(after.rows[0]?.address).not.toBe('a new address');
  });

  /** The error code is the one the partner app already knows how to explain. */
  it('names the refusal so the partner screen can say why', async () => {
    const row = await aPublishedListing(true);
    const service = serviceFor();

    await expect(
      service.update(claimsFor(row), row.reference, {
        latitude: '35.000000',
        longitude: '38.000000',
      }),
    ).rejects.toMatchObject({
      /*
        The CODE, from the response body. `message` on a Nest exception is the human
        sentence — asserting on it would tie this test to English prose that `@safra/i18n`
        exists to keep out of assertions, and it is not what a client reads.
      */
      response: expect.objectContaining({
        code: ERROR.PROPERTY_NOT_STRUCTURALLY_EDITABLE,
      }),
    });
  });
});
