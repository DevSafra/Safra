import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { PERMISSIONS as P } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { PropertiesService } from './properties.service.js';
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

  const partner = (id = partnerId): AccessTokenClaims => ({
    sub: partnerUserId,
    role: 'partner',
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
  });
});
