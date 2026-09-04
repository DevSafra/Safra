import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ERROR, PERMISSIONS as P, propertyCreateSchema } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { PropertiesService } from './properties.service.js';
import { codeOf } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Reading ONE of a partner's own listings, against a real PostgreSQL.
 *
 * ## Why this endpoint needed a test of its own
 *
 * It exists to PREFILL a form. That makes a missing field a data-loss bug rather than a display
 * bug: a form prefilled from a response that omitted the description renders an empty textarea,
 * and the partner who saves it has erased their own copy without ever seeing it. So what is
 * asserted here is mostly completeness — every field the edit form writes must come back.
 *
 * ## And the rule it carries
 *
 * `isStructurallyEditable` decides whether the screen offers a form at all. It has to agree with
 * `update()`, which enforces the same rule, or the partner fills in a form whose submit is
 * refused. Both directions are asserted against the same fixtures.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('PropertiesService.readOwn', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  const db: Database = harness.db;
  const service = new PropertiesService(db, new AuditService(db));

  let partnerId = '';
  let partnerUserId = '';
  let draft = '';
  let published = '';
  let rejected = '';
  let otherPartnerId = '';
  let otherReference = '';

  /**
   * A partner's real token: `property.manage_own` AND `price.update`.
   *
   * `ROLE_PERMISSIONS.partner` carries both. The fixture named only the first, which was harmless
   * until `price.update` started binding on the fields that ARE prices — `initialUnits` on create,
   * `basePrice` on a unit. See `listingClerk` for the account that legitimately has one and not the
   * other.
   */
  const partner = (id = partnerId): AccessTokenClaims => ({
    sub: partnerUserId,
    role: 'partner',
    permissions: [P.PROPERTY_MANAGE_OWN, P.PRICE_UPDATE],
    locale: 'ar',
    totpEnabled: true,
    partnerId: id,
  });

  /** An employee who may write the listing and may NOT decide what it costs. */
  const listingClerk = (id = partnerId): AccessTokenClaims => ({
    sub: partnerUserId,
    role: 'partner_employee',
    permissions: [P.PROPERTY_MANAGE_OWN],
    locale: 'ar',
    totpEnabled: true,
    partnerId: id,
  });

  /**
   * Two partners. The first holds one listing per editability state; the second holds one listing
   * that the first must never be able to read.
   */
  beforeEach(async () => {
    await harness.begin();

    const made = await db.execute<{
      partner_id: string;
      partner_user_id: string;
      draft_reference: string;
      published_reference: string;
      rejected_reference: string;
      other_partner_id: string;
      other_reference: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM property_types LIMIT 1) AS type_id,
               (SELECT id FROM partner_types LIMIT 1) AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1) AS policy_id,
               (SELECT id FROM currencies LIMIT 1) AS currency_id
      ), u AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        SELECT 'prop-test-' || gen_random_uuid() || '@safra.test', '+963900000000',
               'partner', 'active', 'ar'
        FROM generate_series(1, 2)
        RETURNING id
      ), numbered AS (
        SELECT id, row_number() OVER (ORDER BY id) AS n FROM u
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT numbered.id, ref.partner_type_id, 'Prop Test', 'Prop Test', ref.city_id,
               'x', '+963900000000', 'prop@safra.test', 'approved'
        FROM numbered, ref
        RETURNING id, user_id
      ), pa_numbered AS (
        SELECT id, user_id, row_number() OVER (ORDER BY id) AS n FROM pa
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, description_ar, description_en,
                                address, latitude, longitude, attributes, status, review_notes)
        SELECT pa_numbered.id, ref.city_id, ref.type_id, ref.policy_id,
               'prop-test-' || gen_random_uuid(),
               'بيت الاختبار', 'Test House', 'Testhaus',
               'وصف عربي', 'English description',
               'شارع الاختبار ١٢', '33.51', '36.29', ARRAY['sea', 'history'],
               (CASE s.n WHEN 1 THEN 'draft' WHEN 2 THEN 'published' ELSE 'rejected' END)::property_status,
               (CASE s.n WHEN 3 THEN 'العنوان لا يطابق الوثائق' ELSE NULL END)
        FROM generate_series(1, 3) AS s(n), pa_numbered, ref
        WHERE pa_numbered.n = 1
        RETURNING id, reference, status, partner_id
      ), other_pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa_numbered.id, ref.city_id, ref.type_id, ref.policy_id,
               'prop-test-other-' || gen_random_uuid(), 'آخر', 'Other', 'Andere', 'y', 'draft'
        FROM pa_numbered, ref
        WHERE pa_numbered.n = 2
        RETURNING reference, partner_id
      ), un AS (
        -- From the pr CTE's RETURNING, not from the properties table. Every CTE in a statement
        -- reads one snapshot, taken BEFORE the statement ran, so a SELECT against the table here
        -- finds none of the rows pr is inserting and the unit silently attaches to nothing.
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id, min_nights)
        SELECT pr.id, 'غرفة مزدوجة', 'Double', 'Doppel', 2, 75000, ref.currency_id, 2
        FROM pr, ref
        WHERE pr.status = 'draft'
        RETURNING id
      )
      SELECT (SELECT id FROM pa_numbered WHERE n = 1) AS partner_id,
             (SELECT user_id FROM pa_numbered WHERE n = 1) AS partner_user_id,
             (SELECT reference FROM pr WHERE status = 'draft') AS draft_reference,
             (SELECT reference FROM pr WHERE status = 'published') AS published_reference,
             (SELECT reference FROM pr WHERE status = 'rejected') AS rejected_reference,
             (SELECT id FROM pa_numbered WHERE n = 2) AS other_partner_id,
             (SELECT reference FROM other_pr) AS other_reference
    `);

    const row = made.rows[0];

    partnerId = row?.partner_id ?? '';
    partnerUserId = row?.partner_user_id ?? '';
    draft = row?.draft_reference ?? '';
    published = row?.published_reference ?? '';
    rejected = row?.rejected_reference ?? '';
    otherPartnerId = row?.other_partner_id ?? '';
    otherReference = row?.other_reference ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /**
   * Step 7: an UNVERIFIED partner may write a listing, and may not price it (Bashar, 2026-08-21).
   *
   * ## The hole this closes
   *
   * Every dedicated route for a unit, a price, a date or an image carries
   * `@RequireVerifiedPartner()`. `POST /partner/properties` deliberately does not — writing an
   * address and a description while waiting is what «حسابك قيد المراجعة» promises, and taking that
   * away would make the wait pure dead time.
   *
   * Then `initialUnits` was added to that route, so the create form could ask for «عدد الوحدات»
   * and «السعر لليلة» on the same screen. It writes units carrying a `basePrice`. A guard is
   * route-level and cannot refuse one FIELD of a permitted request, so nothing stopped it: an
   * unverified partner could do through the add-property form exactly what
   * `POST properties/:reference/units` refuses them, while the portal told them they could not.
   *
   * Found on the live journey — a partner with no documents uploaded, verification `pending`, one
   * unit at $250 a night — and reproduced here against a `pending` fixture.
   *
   * ## Why the permissive half is tested just as hard
   *
   * The obvious over-correction is to put the guard on the route, which would refuse the whole
   * request and leave an unverified partner unable to do the ONE thing they were promised. Three
   * of the five tests below exist to fail if somebody makes that change.
   */
  describe('the profile every portal page reads', () => {
    /**
     * The suspension REACHES the portal, which for the whole of its first day it did not.
     *
     * `profile()` selected neither `suspended_at` nor `suspended_reason`, and the portal's schema
     * carried `.default(null)` on the object built from them — so `GET /partner/me` never sent it,
     * every page parsed cleanly, and `Shell`, which renders the suspension notice from exactly this
     * field, had nothing to render. The notice could not appear on any screen for any suspended
     * partner, and المحفظة's «التحويلات موقوفة» line was unreachable for the same reason.
     *
     * Found by suspending a partner in a browser and looking at their dashboard. Nothing else would
     * have found it: no test failed, no log recorded anything, and the type checker was satisfied
     * by the default.
     */
    it('carries the suspension, with its reason and its date', async () => {
      await db.execute(sql`
        UPDATE partners
        SET suspended_at = now(), suspended_reason = ${'سبب الإيقاف المعروض للشريك'},
            suspended_notes = ${'ملاحظة داخلية لا يجوز أن تصل الشريك'}
        WHERE id = ${partnerId}::uuid
      `);

      const view = await service.profile(partner());

      expect(view.suspension).not.toBeNull();
      expect(view.suspension?.reason).toBe('سبب الإيقاف المعروض للشريك');
      expect(view.suspension?.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    /**
     * The staff-only note does NOT reach the portal.
     *
     * `suspended_notes` is the one field in a suspension with a different audience, and this
     * profile is read on every page by whoever is signed in — including employees. The assertion
     * walks every string in the payload rather than naming the field: a privacy check phrased as
     * "this particular value is absent" only ever protects the value it names, and the next
     * staff-only field added beside it would walk straight around a narrower test.
     */
    it('never carries the staff-only note, anywhere in the payload', async () => {
      await db.execute(sql`
        UPDATE partners
        SET suspended_at = now(), suspended_reason = ${'سبب الإيقاف المعروض للشريك'},
            suspended_notes = ${'ملاحظة داخلية لا يجوز أن تصل الشريك'}
        WHERE id = ${partnerId}::uuid
      `);

      const view = await service.profile(partner());

      expect(JSON.stringify(view)).not.toContain('ملاحظة داخلية');
    });

    /** The control: a trading partner reports no suspension rather than an empty one. */
    it('reports null for a partner who is not suspended', async () => {
      const view = await service.profile(partner());

      expect(view.suspension).toBeNull();
    });
  });

  describe('units before verification', () => {
    let codes = { citySlug: '', propertyTypeCode: '', cancellationPolicyCode: '' };
    let pendingPartnerId = '';

    beforeEach(async () => {
      const row = await db.execute<{ city: string; type: string; policy: string }>(sql`
        SELECT (SELECT slug FROM cities LIMIT 1)                AS city,
               (SELECT code FROM property_types LIMIT 1)        AS type,
               (SELECT code FROM cancellation_policies LIMIT 1) AS policy
      `);

      const found = row.rows[0];

      codes = {
        citySlug: found?.city ?? '',
        propertyTypeCode: found?.type ?? '',
        cancellationPolicyCode: found?.policy ?? '',
      };

      /* A partner exactly as the journey leaves one: created, waiting, nothing uploaded. */
      const made = await db.execute<{ id: string }>(sql`
        WITH u AS (
          INSERT INTO users (email, phone, role, status, preferred_locale)
          VALUES ('pending-' || gen_random_uuid() || '@safra.test', '+963900000000',
                  'partner', 'active', 'ar')
          RETURNING id
        )
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT u.id, (SELECT id FROM partner_types LIMIT 1), 'Pending', 'Pending',
               (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1), 'x',
               '+963900000000', 'pending@safra.test', 'pending'
        FROM u
        RETURNING id
      `);

      pendingPartnerId = made.rows[0]?.id ?? '';
    });

    const input = (initialUnits?: {
      count: number;
      basePrice: number;
      maxGuests: number;
    }) => ({
      ...codes,
      name: { ar: `عقار ${Math.random().toString(36).slice(2, 8)}` },
      address: 'شارع الاختبار ٧',
      /* Required since 2026-09-04 — every new listing declares its classification. */
      starRating: 4,
      attributes: [],
      ...(initialUnits ? { initialUnits } : {}),
    });

    /** THE assertion. */
    it('refuses initialUnits from a partner who is not verified', async () => {
      await expect(
        service.create(
          partner(pendingPartnerId),
          input({ count: 3, basePrice: 250, maxGuests: 4 }),
        ),
      ).rejects.toMatchObject({ response: { code: ERROR.PARTNER_NOT_VERIFIED } });
    });

    /** And writes nothing — a refusal that left the property behind would be half a listing. */
    it('creates no property when it refuses the units', async () => {
      const before = await db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM properties WHERE partner_id = ${pendingPartnerId}::uuid
      `);

      await service
        .create(
          partner(pendingPartnerId),
          input({ count: 1, basePrice: 10, maxGuests: 2 }),
        )
        .catch(() => null);

      const after = await db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM properties WHERE partner_id = ${pendingPartnerId}::uuid
      `);

      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    });

    /* ── The permissive half. These fail if the guard is moved onto the route. ── */

    it('still lets an unverified partner create the listing itself', async () => {
      const { reference } = await service.create(partner(pendingPartnerId), input());

      expect(reference).toMatch(/^PRO-/);
    });

    it('leaves that listing with no units at all', async () => {
      const { reference } = await service.create(partner(pendingPartnerId), input());
      const read = await service.readOwn(partner(pendingPartnerId), reference);

      expect(read.units).toHaveLength(0);
    });

    /**
     * `price.update` refuses the FIELD, not the route.
     *
     * Two checks refuse `initialUnits` for two different reasons — verification asks whether the
     * BUSINESS may price yet, this asks whether this PERSON may. The pair below is the whole
     * behaviour: the units are refused, and the listing is still created.
     */
    it('refuses initialUnits from an employee without price.update', async () => {
      await expect(
        service.create(listingClerk(), input({ count: 2, basePrice: 120, maxGuests: 3 })),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('still lets that employee create the listing itself', async () => {
      const { reference } = await service.create(listingClerk(), input());

      expect(reference).toMatch(/^PRO-/);
    });

    it('accepts initialUnits from a partner who IS verified', async () => {
      const { reference } = await service.create(
        partner(),
        input({ count: 2, basePrice: 120, maxGuests: 3 }),
      );

      const read = await service.readOwn(partner(), reference);

      expect(read.units).toHaveLength(2);
      expect(read.units[0]?.basePrice).toBe('120.000');
    });
  });

  /**
   * «رقم الغرفة/الوحدة» — the room number a partner gives when creating a listing.
   *
   * On the PROPERTY, optional, and a LABEL rather than a number (Bashar, 2026-08-19). The cases
   * that matter are the empty ones: a blank field must store NULL rather than a room called `''`,
   * because a card renders the number whenever it is truthy and an empty string would print an
   * empty badge on every listing that skipped the field.
   */
  describe('the room number', () => {
    /*
      `create()` takes the codes a form submits, not ids, so they are read from the reference data
      the fixture already relies on rather than hard-coded — a seeded slug changing should not
      silently turn these into a different test.
    */
    let codes = { citySlug: '', propertyTypeCode: '', cancellationPolicyCode: '' };

    beforeEach(async () => {
      const row = await db.execute<{ city: string; type: string; policy: string }>(sql`
        SELECT (SELECT slug FROM cities LIMIT 1)                    AS city,
               (SELECT code FROM property_types LIMIT 1)            AS type,
               (SELECT code FROM cancellation_policies LIMIT 1)     AS policy
      `);

      const found = row.rows[0];

      codes = {
        citySlug: found?.city ?? '',
        propertyTypeCode: found?.type ?? '',
        cancellationPolicyCode: found?.policy ?? '',
      };
    });

    const draftInput = (roomNumber?: string) => ({
      ...codes,
      name: { ar: `عقار ${Math.random().toString(36).slice(2, 8)}` },
      address: 'شارع الاختبار ٣',
      starRating: 3,
      attributes: [],
      ...(roomNumber === undefined ? {} : { roomNumber }),
    });

    it('stores what the partner typed, and reads it back', async () => {
      const { reference } = await service.create(partner(), draftInput('A-12'));

      expect((await service.readOwn(partner(), reference)).roomNumber).toBe('A-12');
    });

    /**
     * The star CLASSIFICATION round-trips (Bashar, 2026-09-04).
     *
     * Proved HERE rather than in a browser, and that placement was a correction: the browser spec
     * created a listing to prove it and thereby leaked three drafts into a shared fixture partner,
     * breaking `partner.spec.ts`'s check that every listing that partner owns is named «قصر
     * الشرق». This suite rolls back, so a listing created here exists for one test.
     */
    it('stores the star classification a hotel declared, and reads it back', async () => {
      const { reference } = await service.create(partner(), {
        ...draftInput(),
        propertyTypeCode: 'hotel',
        starRating: 5,
      });

      expect((await service.readOwn(partner(), reference)).starRating).toBe(5);
    });

    /** And an edit changes it — the «editable later» half of the requirement. */
    it('changes the classification on update', async () => {
      const { reference } = await service.create(partner(), {
        ...draftInput(),
        propertyTypeCode: 'hotel',
        starRating: 2,
      });

      await service.update(partner(), reference, { starRating: 4 });

      expect((await service.readOwn(partner(), reference)).starRating).toBe(4);
    });

    /*
      ── Hotels only (Bashar, 2026-09-04) ────────────────────────────────────────────────────

      «Other accommodation types … should not use the hotel star-classification system. For
      non-hotel accommodation types, the classification should simply be absent rather than forcing
      an artificial star value.»

      The SERVICE is asserted here, not the schema — `property-vocabulary.test.ts` covers the
      contract. This is the guarantee that survives a caller the schema has not met, and the second
      test is the one that matters most: an UPDATE naming only the rating cannot be judged by any
      schema, because the answer depends on what the listing already is.
    */
    it.each(['villa', 'apartment', 'chalet', 'camp'])(
      'stores no classification for a %s, even when one is sent',
      async (code) => {
        const { reference } = await service.create(partner(), {
          ...draftInput(),
          propertyTypeCode: code,
        });

        expect((await service.readOwn(partner(), reference)).starRating).toBeNull();
      },
    );

    /*
      ── Changing the property type (Bashar, 2026-09-04) ──────────────────────────────────────

      «If the API accepts a property type change request, then the change must either be fully
      supported or explicitly refused. I do not want requests that appear to succeed while silently
      ignoring the requested change.»

      It is SUPPORTED, and these prove the two dependent rules move with it. The first is the whole
      bug: the patch used to return 200 and change nothing.
    */
    it('actually changes the property type, rather than accepting and ignoring it', async () => {
      const { reference } = await service.create(partner(), {
        ...draftInput(),
        propertyTypeCode: 'villa',
      });

      await service.update(partner(), reference, {
        propertyTypeCode: 'apartment',
      });

      expect((await service.readOwn(partner(), reference)).propertyTypeCode).toBe(
        'apartment',
      );
    });

    it('clears the classification when a hotel becomes a villa', async () => {
      const { reference } = await service.create(partner(), {
        ...draftInput(),
        propertyTypeCode: 'hotel',
        starRating: 5,
      });

      await service.update(partner(), reference, { propertyTypeCode: 'villa' });

      const after = await service.readOwn(partner(), reference);

      expect(after.propertyTypeCode).toBe('villa');
      expect(after.starRating, 'a villa cannot carry a classification').toBeNull();
    });

    it('accepts a villa becoming a hotel when the same patch classifies it', async () => {
      const { reference } = await service.create(partner(), {
        ...draftInput(),
        propertyTypeCode: 'villa',
      });

      await service.update(partner(), reference, {
        propertyTypeCode: 'hotel',
        starRating: 4,
      });

      const after = await service.readOwn(partner(), reference);

      expect(after.propertyTypeCode).toBe('hotel');
      expect(after.starRating).toBe(4);
    });

    it('refuses a villa becoming a hotel with no classification', async () => {
      const { reference } = await service.create(partner(), {
        ...draftInput(),
        propertyTypeCode: 'villa',
      });

      await expect(
        service.update(partner(), reference, { propertyTypeCode: 'hotel' }),
      ).rejects.toMatchObject({
        response: { code: 'validation.star_rating_required' },
      });
    });

    it('refuses a type that does not exist, rather than ignoring it', async () => {
      const { reference } = await service.create(partner(), {
        ...draftInput(),
        propertyTypeCode: 'villa',
      });

      await expect(
        service.update(partner(), reference, { propertyTypeCode: 'submarine' }),
      ).rejects.toMatchObject({ response: { code: 'property.type_unknown' } });
    });

    it('refuses to classify a villa on update', async () => {
      const { reference } = await service.create(partner(), {
        ...draftInput(),
        propertyTypeCode: 'villa',
      });

      await expect(
        service.update(partner(), reference, { starRating: 4 }),
      ).rejects.toMatchObject({
        response: { code: 'validation.star_rating_not_a_hotel' },
      });
    });

    /** The opposite control: the same update on a HOTEL is accepted. */
    it('classifies a hotel on update', async () => {
      const { reference } = await service.create(partner(), {
        ...draftInput(),
        propertyTypeCode: 'hotel',
        starRating: 3,
      });

      await service.update(partner(), reference, { starRating: 4 });

      expect((await service.readOwn(partner(), reference)).starRating).toBe(4);
    });

    /**
     * The DATABASE refuses what the schema would refuse, which is the check a script meets.
     *
     * `propertyCreateSchema` bounds it 1-5 at the boundary and that is what a person meets. This
     * asserts the CHECK constraint behind it, so a repair script or a future endpoint cannot write
     * a nine-star hotel — the reason the constraint exists rather than only the schema.
     */
    it('refuses a classification outside 1-5 at the database', async () => {
      const { reference } = await service.create(partner(), {
        ...draftInput(),
        propertyTypeCode: 'hotel',
        starRating: 3,
      });

      await expect(
        db.execute(
          sql`UPDATE properties SET star_rating = 9 WHERE reference = ${reference}`,
        ),
      ).rejects.toThrow();
    });

    it('stores nothing when the field was left out', async () => {
      const { reference } = await service.create(partner(), draftInput());

      expect((await service.readOwn(partner(), reference)).roomNumber).toBeNull();
    });

    /* A field submitted with only spaces is empty, not a room whose name is a space. */
    it.each(['', '   '])(
      'stores null for %j rather than an empty label',
      async (blank) => {
        const { reference } = await service.create(partner(), draftInput(blank));

        expect((await service.readOwn(partner(), reference)).roomNumber).toBeNull();
      },
    );

    it('can be changed, and CLEARED, after creation', async () => {
      const { reference } = await service.create(partner(), draftInput('101'));

      await service.update(partner(), reference, { roomNumber: '3ب' });
      expect((await service.readOwn(partner(), reference)).roomNumber).toBe('3ب');

      /* Clearing is how a partner removes a number typed by mistake. */
      await service.update(partner(), reference, { roomNumber: '' });
      expect((await service.readOwn(partner(), reference)).roomNumber).toBeNull();
    });

    /* Untouched by a patch that does not mention it — PATCH semantics, not replace. */
    it('survives an edit that changes something else', async () => {
      const { reference } = await service.create(partner(), draftInput('A-12'));

      await service.update(partner(), reference, { address: 'شارع آخر ٩' });

      expect((await service.readOwn(partner(), reference)).roomNumber).toBe('A-12');
    });

    /* It is printed beside the listing name, so the cap is what keeps a card a card. */
    it('refuses a value too long to sit beside a name', () => {
      const parsed = propertyCreateSchema.safeParse(draftInput('X'.repeat(21)));

      expect(parsed.success).toBe(false);
    });

    it('appears in the listing card query', async () => {
      const { reference } = await service.create(partner(), draftInput('A-12'));
      const listed = await service.listOwn(partner());

      expect(listed.find((row) => row.reference === reference)?.roomNumber).toBe('A-12');
    });
  });

  describe('what the form prefills from', () => {
    /**
     * The completeness assertion. Every field named here is one the edit form writes back, and a
     * field that arrives `undefined` is a field the partner silently clears by saving.
     */
    it('returns every field the edit form writes', async () => {
      const property = await service.readOwn(partner(), draft);

      expect(property.name.ar).toBe('بيت الاختبار');
      expect(property.name.en).toBe('Test House');
      expect(property.name.de).toBe('Testhaus');
      expect(property.description.ar).toBe('وصف عربي');
      expect(property.description.en).toBe('English description');
      expect(property.address).toBe('شارع الاختبار ١٢');
      expect(property.latitude).toBe('33.51');
      expect(property.longitude).toBe('36.29');
      expect(property.attributes).toEqual(['sea', 'history']);

      /* CODES, not display names: a select's value has to be what the API accepts back. */
      expect(property.citySlug).toMatch(/^[a-z0-9-]+$/);
      expect(property.propertyTypeCode).toMatch(/^[a-z_]+$/);
      expect(property.cancellationPolicyCode).toMatch(/^[a-z_]+$/);
    });

    it('carries the units a calendar is chosen by', async () => {
      const property = await service.readOwn(partner(), draft);

      expect(property.units).toHaveLength(1);
      expect(property.units[0]?.nameAr).toBe('غرفة مزدوجة');
      expect(property.units[0]?.maxGuests).toBe(2);
      expect(property.units[0]?.minNights).toBe(2);
      expect(property.units[0]?.currencyCode).toMatch(/^[A-Z]{3}$/);
      expect(property.units[0]?.isActive).toBe(true);
    });

    it('reports a listing with no units as having none, rather than failing', async () => {
      const property = await service.readOwn(partner(), published);

      expect(property.units).toEqual([]);
    });
  });

  describe('whether the screen offers a form', () => {
    it('allows a draft', async () => {
      expect((await service.readOwn(partner(), draft)).isStructurallyEditable).toBe(true);
    });

    it('allows a rejected listing, and says why it was rejected', async () => {
      const property = await service.readOwn(partner(), rejected);

      expect(property.isStructurallyEditable).toBe(true);
      /* Reopening the form without the reason would be asking somebody to guess. */
      expect(property.reviewNotes).toBe('العنوان لا يطابق الوثائق');
    });

    it('refuses a published listing, because verification would be invalidated', async () => {
      expect((await service.readOwn(partner(), published)).isStructurallyEditable).toBe(
        false,
      );
    });

    /**
     * The flag and the enforcement have to agree. A screen that offered a form the endpoint then
     * refused would waste the partner's work; one that hid a form the endpoint would have accepted
     * would make the product look broken.
     */
    it('agrees with what update() actually enforces', async () => {
      const editable = await service.readOwn(partner(), draft);
      const frozen = await service.readOwn(partner(), published);

      expect(editable.isStructurallyEditable).toBe(true);
      await expect(
        service.update(partner(), draft, { address: 'شارع جديد ٤٥' }),
      ).resolves.toBeDefined();

      expect(frozen.isStructurallyEditable).toBe(false);
      await expect(
        service.update(partner(), published, { address: 'شارع جديد ٤٥' }),
      ).rejects.toThrow();
    });

    /* Only a rejection has notes worth showing; a draft's absent notes must not read as a rejection. */
    it('carries no review notes for a listing that was never rejected', async () => {
      expect((await service.readOwn(partner(), draft)).reviewNotes).toBeNull();
    });
  });

  describe('scoping', () => {
    /**
     * 404, not 403. A 403 confirms the reference EXISTS and belongs to somebody, which turns the
     * endpoint into an oracle for enumerating other partners' listings.
     */
    it("answers 404 for another partner's listing", async () => {
      await expect(service.readOwn(partner(), otherReference)).rejects.toThrow();
    });

    it('answers 404 for a reference that does not exist at all', async () => {
      await expect(service.readOwn(partner(), 'PRO-000000')).rejects.toThrow();
    });

    /* The same reference, read by the partner who owns it, must work — or the test above proves nothing. */
    it('returns that same listing to the partner who owns it', async () => {
      const property = await service.readOwn(partner(otherPartnerId), otherReference);

      expect(property.reference).toBe(otherReference);
    });

    it('refuses a caller with no partner id at all', async () => {
      await expect(
        service.readOwn({ ...partner(), partnerId: undefined }, draft),
      ).rejects.toThrow();
    });

    /**
     * The two WRITES the portal gained on 2026-09-04, scoped the same way as the read.
     *
     * They matter more than the read does: submitting another partner's listing would put it in
     * front of SAFRA's reviewers as though its owner had asked, and adding a unit to one would put
     * a price on somebody else's inventory. Both go through `findOwned`, whose partner id is a
     * `WHERE` clause rather than a check afterwards — so the refusal is a 404, identical to a
     * reference that does not exist, and the endpoint cannot be used to enumerate listings.
     *
     * Each has its opposite control below. Without those, a fixture that could not reach the code
     * at all would produce exactly these two passes.
     */
    it("refuses to submit another partner's listing", async () => {
      /*
        The CODE, not the message. `message` carries English prose for logs and must never be what
        an assertion or a client reads — the rule `no-raw-error-messages.test.ts` holds everywhere
        else, and a test that matched on it would freeze the wording.
      */
      expect(
        codeOf(
          await service
            .submitForReview(partner(), otherReference)
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.PROPERTY_NOT_FOUND);
    });

    it("refuses to add a unit to another partner's listing", async () => {
      expect(
        codeOf(
          await service
            .addUnit(partner(), otherReference, {
              name: { ar: 'وحدة' },
              maxGuests: 2,
              bedrooms: 1,
              beds: 1,
              bathrooms: 1,
              basePrice: 100,
              currencyCode: 'USD',
              minNights: 1,
              amenityCodes: [],
            })
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.PROPERTY_NOT_FOUND);
    });

    /* The controls: the same calls, by the partner who owns the listing, must reach the rule. */
    it('lets the owner add a unit to their own listing', async () => {
      const created = await service.addUnit(partner(otherPartnerId), otherReference, {
        name: { ar: 'وحدة المالك' },
        maxGuests: 2,
        bedrooms: 1,
        beds: 1,
        bathrooms: 1,
        basePrice: 100,
        currencyCode: 'USD',
        minNights: 1,
        amenityCodes: [],
      });

      expect(created).toBeTruthy();
    });

    /**
     * And the owner's submit reaches a DIFFERENT rule from the ownership one.
     *
     * The listing has no unit, so the owner is stopped by `property.unit_required` — a refusal
     * that can only be reached from INSIDE `findOwned`. That difference is the whole assertion:
     * it proves the two refusals above are about ownership rather than about a fixture that could
     * not reach the code at all, which is the failure a scoping test is most prone to.
     */
    it('lets the owner past the ownership check, to the lifecycle rules', async () => {
      expect(
        codeOf(
          await service
            .submitForReview(partner(otherPartnerId), otherReference)
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.PROPERTY_UNIT_REQUIRED);
    });
  });
});
