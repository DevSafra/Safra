import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import {
  DisputeEvidenceService,
  EVIDENCE_WIDTH,
  evidenceVariant,
} from './dispute-evidence.service.js';
import { ImageService } from '../storage/image.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Photographs on a dispute — the gap that made «الغرفة لا تطابق الصور المنشورة» undecidable.
 *
 * ## What is worth asserting
 *
 * That this is the SAME pipeline as every other picture on the platform, and that the two routes
 * into it have the two different authorisations they need. The security of every image SAFRA serves
 * lives in `ImageService` — magic bytes checked before a byte is stored, every served byte
 * re-encoded by us, EXIF stripped — and the way that gets lost is a second upload path that looks
 * similar and skips a step.
 *
 * EXIF matters more here than anywhere else on the platform: this is a photograph taken inside a
 * room, by a person, on their own phone, and it is filed in anger.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** A real photograph — the same fixture the listing and creative suites use. */
const PHOTO = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '..', 'e2e', 'fixtures', 'room-one.jpg'),
);

describeIfDb('evidence on a dispute', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let stored: { key: string; bytes: number }[] = [];
  let enqueued: Record<string, unknown>[] = [];

  /** The key `readFile` asked storage for, so «which variant» is observable. */
  let fetched = '';

  const storage = {
    put: (key: string, body: Buffer) => {
      stored.push({ key, bytes: body.length });

      return Promise.resolve();
    },
    get: (key: string) => {
      fetched = key;

      return Promise.resolve(Buffer.from('rendered bytes'));
    },
    publicUrl: (key: string) => `https://media.test/${key}`,
  };
  const queue = {
    add: (
      _name: string,
      data: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => {
      enqueued.push({ ...data, jobId: options['jobId'] });

      return Promise.resolve();
    },
  };

  const images = new ImageService(storage as never);
  const service = new DisputeEvidenceService(
    db,
    new AuditService(db),
    images,
    storage as never,
    queue as never,
  );

  let reference = '';
  let disputeId = '';
  let customerUserId = '';
  let staffId = '';
  let cityId = '';

  const customer = (): AccessTokenClaims =>
    ({
      sub: customerUserId,
      role: 'customer',
      permissions: [],
    }) as unknown as AccessTokenClaims;

  const staff = (scope?: string[]): AccessTokenClaims =>
    ({
      sub: staffId,
      role: scope ? 'operations_manager' : 'super_admin',
      permissions: ['dispute.manage'],
      ...(scope ? { scope: { kind: 'cities', cityIds: scope, outside: 'none' } } : {}),
    }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();
    stored = [];
    enqueued = [];
    fetched = '';

    const made = await db.execute<{
      id: string;
      reference: string;
      customer_user: string;
      staff: string;
      city_id: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL ORDER BY id LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')                       AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                              AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                               AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)                       AS policy_id
      ), st AS (
        INSERT INTO users (email, phone, role, status)
        VALUES (${`ev-s-${randomUUID()}@safra.test`}, '+963900000160', 'super_admin', 'active')
        RETURNING id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES (${`ev-c-${randomUUID()}@safra.test`}, '+963900000161', 'customer', 'active')
        RETURNING id, email
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'صاحب الشكوى', cu.email, '+963900000161', false FROM cu
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES (${`ev-p-${randomUUID()}@safra.test`}, '+963900000162', 'partner', 'active')
        RETURNING id, email
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Evidence Test', 'شريك الدليل', ref.city_id, 'x',
               '+963900000162', pu.email, 'approved'
        FROM pu, ref RETURNING id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               ${`ev-${randomUUID()}`}, 'عقار', 'Property', 'Objekt', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 4, '100.00', ref.currency_id FROM pr, ref
        RETURNING id
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot, paid_at)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 2400, current_date + 2402, 2, 'confirmed'::booking_status,
               '100.00', '9.00', '9.00', '0.0700', '7.00', '109.00', '93.00',
               ref.currency_id, '13000.00000000', '1417000.00', '{"code":"flex"}'::jsonb, now()
        FROM cp, un, pr, ref RETURNING id
      )
      INSERT INTO disputes (booking_id, partner_id, customer_profile_id, kind, status, title)
      SELECT bk.id, pr.partner_id, cp.id, 'not_as_described', 'open', 'الغرفة لا تطابق الصور'
      FROM bk, pr, cp
      RETURNING id, reference,
                (SELECT id::text FROM cu) AS customer_user,
                (SELECT id::text FROM st) AS staff,
                (SELECT city_id::text FROM ref) AS city_id
    `);

    const row = made.rows[0];

    if (!row) throw new Error('the evidence fixture built no dispute');

    disputeId = row.id;
    reference = row.reference;
    customerUserId = row.customer_user;
    staffId = row.staff;
    cityId = row.city_id;
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /**
   * The whole reason this reuses `ImageService`: a file that is not a photograph never reaches
   * storage. Refused by its BYTES, not by its name or the `Content-Type` the client claimed.
   */
  it('refuses something that is not an image before anything is stored', async () => {
    await expect(
      service.addAsCustomer(customer(), reference, {
        buffer: Buffer.from('#!/bin/sh\necho not a photograph\n'),
        originalname: 'evidence.png',
      }),
    ).rejects.toMatchObject({ response: {} });

    expect(stored, 'nothing was written to the object store').toStrictEqual([]);
    expect(enqueued, 'and nothing was queued').toStrictEqual([]);
  });

  /**
   * A customer's photograph: stored, recorded, queued — and NOT yet displayable.
   *
   * `url` is null until the worker has rendered it. Returning an address for a file that does not
   * exist yet is how a broken image reaches a screen that believes it is fine, which is exactly the
   * defect ad creatives shipped with on 2026-08-27.
   */
  it('takes a photograph from the customer and queues it for rendering', async () => {
    const added = await service.addAsCustomer(customer(), reference, {
      buffer: PHOTO,
      originalname: 'room.jpg',
    });

    expect(added.rendered, 'nothing is displayable until the worker has run').toBe(false);
    expect(added.byStaff, 'the customer filed it').toBe(false);

    /* The original is parked under the private incoming prefix, BEFORE the row points at it. */
    expect(stored, 'exactly one object, and it is the original').toHaveLength(1);
    expect(stored[0]?.key).toContain('incoming/');

    expect(enqueued, 'one render was queued').toHaveLength(1);
    expect(enqueued[0]?.['subject'], 'as evidence, not as a listing photo').toBe(
      'dispute_evidence',
    );

    const rows = await db.execute<{ n: string; by_staff: boolean }>(sql`
      SELECT count(*)::text AS n, bool_or(uploaded_by_user_id IS NOT NULL) AS by_staff
      FROM dispute_evidence WHERE dispute_id = ${disputeId}::uuid
    `);

    expect(rows.rows[0]?.n, 'and the row is there').toBe('1');
    expect(
      rows.rows[0]?.by_staff,
      'with uploaded_by NULL, which is the schema’s way of saying the customer filed it',
    ).toBe(false);
  });

  /** Staff file evidence too, and the row says which of them it was. */
  it('records that a staff member filed it, when one did', async () => {
    const added = await service.addAsStaff(staff(), reference, {
      buffer: PHOTO,
      originalname: 'phoned-in.jpg',
    });

    expect(added.byStaff).toBe(true);

    const rows = await db.execute<{ by: string | null }>(sql`
      SELECT uploaded_by_user_id::text AS by FROM dispute_evidence
      WHERE dispute_id = ${disputeId}::uuid
    `);

    expect(rows.rows[0]?.by, 'the staff member is named').toBe(staffId);
  });

  /**
   * A customer cannot file on somebody else's dispute, and is refused as if it did not exist.
   *
   * The control matters as much as the refusal: «withheld» and «absent» are indistinguishable
   * without showing that the owner still succeeds.
   */
  it('refuses a dispute that is not the caller’s, as if it were not there', async () => {
    const stranger = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES (${`ev-x-${randomUUID()}@safra.test`}, '+963900000163', 'customer', 'active')
      RETURNING id
    `);

    const other = {
      sub: stranger.rows[0]?.id,
      role: 'customer',
      permissions: [],
    } as unknown as AccessTokenClaims;

    await expect(
      service.addAsCustomer(other, reference, { buffer: PHOTO, originalname: 'x.jpg' }),
    ).rejects.toMatchObject({ response: { code: ERROR.DISPUTE_NOT_FOUND } });

    expect(stored, 'and nothing was stored on the way to being refused').toStrictEqual(
      [],
    );

    /* The control: the owner can. */
    await expect(
      service.addAsCustomer(customer(), reference, {
        buffer: PHOTO,
        originalname: 'x.jpg',
      }),
    ).resolves.toMatchObject({ byStaff: false });
  });

  /** Out of a staff member's cities answers exactly as absent — the same shape as every dispute write. */
  it('refuses a dispute in a city this staff member cannot see', async () => {
    const elsewhere = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM cities WHERE deleted_at IS NULL AND id <> ${cityId}::uuid LIMIT 1
    `);
    const other = elsewhere.rows[0]?.id;

    if (!other) throw new Error('the fixture needs a second city');

    await expect(
      service.addAsStaff(staff([other]), reference, {
        buffer: PHOTO,
        originalname: 'x.jpg',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.DISPUTE_NOT_FOUND } });

    /* The control: a member scoped to the right city can. */
    await expect(
      service.addAsStaff(staff([cityId]), reference, {
        buffer: PHOTO,
        originalname: 'x.jpg',
      }),
    ).resolves.toMatchObject({ byStaff: true });
  });

  /**
   * A settled dispute takes no more evidence.
   *
   * The file is the record of a decision that has been made; adding to it afterwards would leave a
   * resolution that cannot be read against what was in front of the person who wrote it.
   */
  it('refuses to add to a dispute that has been settled', async () => {
    await db.execute(sql`
      UPDATE disputes SET status = 'resolved', resolution = 'settled', closed_at = now()
      WHERE id = ${disputeId}::uuid
    `);

    await expect(
      service.addAsCustomer(customer(), reference, {
        buffer: PHOTO,
        originalname: 'late.jpg',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.DISPUTE_ALREADY_CLOSED } });

    expect(stored, 'nothing stored for a dispute that is finished').toStrictEqual([]);
  });

  /** Every upload gets its own job id, so a second photograph is not swallowed by the first. */
  it('queues a distinct render per photograph', async () => {
    await service.addAsCustomer(customer(), reference, {
      buffer: PHOTO,
      originalname: 'one.jpg',
    });
    await service.addAsCustomer(customer(), reference, {
      buffer: PHOTO,
      originalname: 'two.jpg',
    });

    const ids = enqueued.map((job) => job['jobId']);

    expect(new Set(ids).size, 'two uploads, two jobs').toBe(2);
  });

  /**
   * The variant served is one that EXISTS.
   *
   * The pipeline never upscales, so a 640px photograph has no 800 and asking for a fixed width
   * addresses an object that was never written — a 404 behind a picture the row says is fine.
   * `null` while nothing has rendered, which is also how «still processing» is expressed.
   */
  it('serves the widest variant at or below the target, and nothing before then', () => {
    expect(evidenceVariant(null), 'not rendered yet').toBeNull();
    expect(evidenceVariant([]), 'nor with an empty list').toBeNull();
    expect(evidenceVariant([400, 640]), 'a small photograph').toBe(640);
    expect(evidenceVariant([400, 800, 1024]), 'a large one stops at the target').toBe(
      EVIDENCE_WIDTH,
    );
  });

  /**
   * The BYTES are private, and «not yours» answers as «not there».
   *
   * A photograph of the inside of somebody's home, filed in a complaint, is not published the way a
   * listing photograph is. The schema said so from the first migration — «no file is served without
   * an authorization check per request» — and the bucket policy deliberately does not include this
   * prefix. The control is that the owner CAN read it, so «withheld» is distinguishable from
   * «broken».
   */
  it('serves the bytes to the owner and refuses everybody else', async () => {
    const added = await service.addAsCustomer(customer(), reference, {
      buffer: PHOTO,
      originalname: 'room.jpg',
    });

    /* Nothing rendered yet, so there is nothing to serve — to anybody. */
    await expect(
      service.readFile(added.id, customer(), 'customer'),
    ).rejects.toMatchObject({
      response: { code: ERROR.DISPUTE_NOT_FOUND },
    });

    /* The worker has run. */
    await db.execute(sql`
      UPDATE dispute_evidence SET variant_widths = ARRAY[400, 800]
      WHERE id = ${added.id}::uuid
    `);

    const stranger = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES (${`ev-y-${randomUUID()}@safra.test`}, '+963900000164', 'customer', 'active')
      RETURNING id
    `);

    await expect(
      service.readFile(
        added.id,
        { sub: stranger.rows[0]?.id, role: 'customer' } as unknown as AccessTokenClaims,
        'customer',
      ),
    ).rejects.toMatchObject({ response: { code: ERROR.DISPUTE_NOT_FOUND } });

    /* And the control: the owner is served, from the RE-ENCODED variant. */
    const served = await service.readFile(added.id, customer(), 'customer');

    expect(served.contentType, 'what our renderer produced, not what was uploaded').toBe(
      'image/avif',
    );
    expect(fetched, 'the widest variant at or below the target').toContain('-800.avif');
  });

  /* ── Removing one, which the table was built not to allow ─────────────────── */

  /**
   * A photograph filed by mistake can be retired, and nothing is destroyed.
   *
   * The table's own note said «evidence that can be edited or removed after the fact is not
   * evidence». Right about the record, wrong about the frame — a duplicate, a wrong file, somebody
   * else's face in shot. Bashar asked for it on 2026-08-30, so removal is a SOFT delete with an
   * audit row: the row stays and is answerable, the picture stops counting and stops being served.
   */
  it('retires a photograph without destroying the row, and records who did', async () => {
    const added = await service.addAsStaff(staff(), reference, {
      buffer: PHOTO,
      originalname: 'wrong-room.jpg',
    });

    expect(await service.forDispute(disputeId)).toHaveLength(1);

    await expect(service.remove(staff(), added.id)).resolves.toEqual({ removed: true });

    /* Gone from the file… */
    expect(await service.forDispute(disputeId)).toHaveLength(0);

    /* …and still THERE, which is the whole point of a soft delete. */
    const row = await db.execute<{ n: string; retired: boolean }>(sql`
      SELECT count(*)::text AS n, bool_and(deleted_at IS NOT NULL) AS retired
      FROM dispute_evidence WHERE id = ${added.id}::uuid
    `);

    expect(row.rows[0]).toMatchObject({ n: '1', retired: true });

    const logged = await db.execute<{ actor: string | null; before: unknown }>(sql`
      SELECT actor_user_id AS actor, before FROM audit_log
      WHERE action = 'dispute.evidence_removed' AND subject_id = ${disputeId}::uuid
      ORDER BY created_at DESC LIMIT 1
    `);

    expect(logged.rows[0]?.actor).toBe(staffId);
    /* WHICH photograph went, by the name it was filed under. */
    expect(JSON.stringify(logged.rows[0]?.before)).toContain('wrong-room.jpg');
  });

  /** The bytes stop being served the moment the row is retired — for staff and for the customer. */
  it('stops serving a retired photograph to anybody', async () => {
    const added = await service.addAsCustomer(customer(), reference, {
      buffer: PHOTO,
      originalname: 'room.jpg',
    });

    /* The worker has not run in this suite, and an unrendered row is served to nobody. */
    await db.execute(sql`
      UPDATE dispute_evidence SET variant_widths = ARRAY[400, 800]
      WHERE id = ${added.id}::uuid
    `);

    /* The control: it is served while it is live. */
    await expect(
      service.readFile(added.id, customer(), 'customer'),
    ).resolves.toBeTruthy();

    await service.remove(staff(), added.id);

    await expect(
      service.readFile(added.id, customer(), 'customer'),
    ).rejects.toMatchObject({ response: { code: ERROR.DISPUTE_NOT_FOUND } });

    await expect(service.readFile(added.id, staff(), 'staff')).rejects.toMatchObject({
      response: { code: ERROR.DISPUTE_NOT_FOUND },
    });
  });

  /** A second press is an ordinary thing to do to a card. It must not write a second audit row. */
  it('does nothing on a second removal, and says so', async () => {
    const added = await service.addAsStaff(staff(), reference, {
      buffer: PHOTO,
      originalname: 'twice.jpg',
    });

    await service.remove(staff(), added.id);

    await expect(service.remove(staff(), added.id)).resolves.toEqual({ removed: false });

    const logged = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM audit_log
      WHERE action = 'dispute.evidence_removed' AND subject_id = ${disputeId}::uuid
    `);

    expect(logged.rows[0]?.n).toBe('1');
  });

  /**
   * A closed dispute takes no removals, for the same reason it takes no additions: the resolution
   * must stay readable against what was in front of the person who wrote it.
   */
  it('refuses to empty the file of a dispute that is already settled', async () => {
    const added = await service.addAsStaff(staff(), reference, {
      buffer: PHOTO,
      originalname: 'settled.jpg',
    });

    await db.execute(sql`
      UPDATE disputes
      SET status = 'resolved', resolution = 'تمت التسوية.', closed_at = now()
      WHERE id = ${disputeId}::uuid
    `);

    await expect(service.remove(staff(), added.id)).rejects.toMatchObject({
      response: { code: ERROR.DISPUTE_ALREADY_CLOSED },
    });

    /* And it is still in the file. */
    expect(await service.forDispute(disputeId)).toHaveLength(1);
  });

  /** Scope, both ways: an id outside a reader's cities answers as one that does not exist. */
  it('refuses a removal from another city, and allows one in its own', async () => {
    const added = await service.addAsStaff(staff(), reference, {
      buffer: PHOTO,
      originalname: 'scoped.jpg',
    });

    const elsewhere = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM cities WHERE id <> ${cityId}::uuid AND deleted_at IS NULL LIMIT 1
    `);
    const away = elsewhere.rows[0]?.id;

    expect(away, 'a second city to be scoped away from').toBeTruthy();

    await expect(service.remove(staff([away ?? '']), added.id)).rejects.toMatchObject({
      response: { code: ERROR.DISPUTE_NOT_FOUND },
    });

    /* The control: the operator whose city it is can. */
    await expect(service.remove(staff([cityId]), added.id)).resolves.toEqual({
      removed: true,
    });
  });
});
