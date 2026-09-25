import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR, PERMISSIONS as P } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import type { AccessTokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { codeOf } from '../common/errors/app-error.js';
import { PropertiesService } from './properties.service.js';

/**
 * What a listing must have before SAFRA will look at it.
 *
 * ## Why a location is now one of those things
 *
 * 67 of 2,017 published listings carried coordinates — 3.3% — so the map SAFRA built was dark for
 * the whole catalogue. The cause was never partner reluctance: the form asked «خط العرض (اختياري)»
 * of somebody who runs a guest house, and there is no way to answer that. The picker fixed the
 * asking; this fixes the ASKING AT ALL, at the one moment it can still be asked for free.
 *
 * Submission is that moment, and it is the last one. §8.1 freezes the address the instant this
 * succeeds, so a listing that goes through unplaced can afterwards only be fixed by a support
 * ticket — which is the 97% this exists to stop recurring.
 *
 * ## The order of the two rules is load-bearing, and asserted
 *
 * A listing with neither a unit nor a location meets `property.unit_required` first. That is not an
 * accident of statement order: the partner's own screen shows BOTH blockers at once, so whichever
 * the API names, the reader has already been told about both — and pinning the order here means the
 * existing ownership test, which reaches `unit_required` through a listing that also has no
 * coordinates, keeps testing what it was written to test.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('submitting a listing for review', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const service = new PropertiesService(db, new AuditService(db));

  let partnerId = '';
  let partnerUserId = '';

  const partner = (): AccessTokenClaims => ({
    sub: partnerUserId,
    role: 'partner',
    permissions: [P.PROPERTY_MANAGE_OWN, P.PRICE_UPDATE],
    locale: 'ar',
    totpEnabled: true,
    partnerId,
  });

  beforeEach(async () => {
    await harness.begin();

    const made = await db.execute<{ partner_id: string; user_id: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM partner_types LIMIT 1) AS partner_type_id,
               (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id
      ), u AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        SELECT 'submit-test-' || gen_random_uuid() || '@safra.test', '+963900000000',
               'partner', 'active', 'ar'
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT u.id, ref.partner_type_id, 'Submit Test', 'Submit Test', ref.city_id,
               'x', '+963900000000', 'submit@safra.test', 'approved'
        FROM u, ref
        RETURNING id, user_id
      )
      SELECT id AS partner_id, user_id FROM pa
    `);

    partnerId = made.rows[0]?.partner_id ?? '';
    partnerUserId = made.rows[0]?.user_id ?? '';

    /* A fixture that cannot reach the rule reports coverage it does not have. */
    if (!partnerId) throw new Error('the submit fixture built no partner');
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** A draft, carrying exactly the requirements a case needs and no others. */
  async function aDraft(options: {
    unit: boolean;
    placed: boolean;
    photograph?: boolean;
    described?: boolean;
  }) {
    /* Default to PRESENT, so a case naming one missing requirement tests only that one. */
    const photograph = options.photograph ?? true;
    const described = options.described ?? true;

    const rows = await db.execute<{ reference: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM property_types LIMIT 1) AS type_id,
               (SELECT id FROM cancellation_policies LIMIT 1) AS policy_id,
               (SELECT id FROM currencies LIMIT 1) AS currency_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address,
                                description_ar,
                                latitude, longitude, status)
        SELECT ${partnerId}, ref.city_id, ref.type_id, ref.policy_id,
               'submit-test-' || gen_random_uuid(),
               'بيت الإرسال', 'Submit House', 'Einreichhaus', 'شارع الاختبار ١٢',
               ${described ? 'وصف عربي كامل.' : null},
               ${options.placed ? '33.5123' : null}, ${options.placed ? '36.2988' : null},
               'draft'
        FROM ref
        RETURNING id, reference
      ), un AS (
        -- From pr's RETURNING: every CTE reads the snapshot taken BEFORE the statement ran, so a
        -- SELECT against the properties table here finds nothing and the unit attaches to nothing.
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id, min_nights)
        SELECT pr.id, 'غرفة', 'Room', 'Zimmer', 2, 75000, ref.currency_id, 1
        FROM pr, ref
        WHERE ${options.unit}
        RETURNING id
      ), img AS (
        -- From pr's RETURNING, for the reason the unit insert above gives.
        INSERT INTO property_images (property_id, file_key, width, height, variant_widths,
                                     is_cover, sort_order, status)
        SELECT pr.id, 'submit-test/' || pr.id || '.jpg', 1600, 1200, ARRAY[400, 800, 1600],
               true, 0, 'ready'
        FROM pr
        WHERE ${photograph}
        RETURNING id
      )
      SELECT reference FROM pr
    `);

    const reference = rows.rows[0]?.reference;

    if (!reference) throw new Error('the submit fixture built no listing');

    return reference;
  }

  it('refuses a listing that has never been placed on the map', async () => {
    const reference = await aDraft({ unit: true, placed: false });

    expect(
      codeOf(
        await service.submitForReview(partner(), reference).catch((e: unknown) => e),
      ),
    ).toBe(ERROR.PROPERTY_LOCATION_REQUIRED);
  });

  /**
   * The opposite control, and the test that stops this being «refuse everything».
   *
   * A refusal is indistinguishable from a broken fixture without it: if the listing could not be
   * submitted for some unrelated reason, the assertion above would pass for the wrong reason and
   * keep passing after the rule was deleted.
   */
  it('accepts the same listing once it has been placed', async () => {
    /* The fixture carries a photograph and a description by default — see `aDraft`. */
    const reference = await aDraft({ unit: true, placed: true });
    const result = await service.submitForReview(partner(), reference);

    expect(result.status).toBe('pending_review');
  });

  it('still refuses a listing with no unit, placed or not', async () => {
    const placed = await aDraft({ unit: false, placed: true });

    expect(
      codeOf(await service.submitForReview(partner(), placed).catch((e: unknown) => e)),
    ).toBe(ERROR.PROPERTY_UNIT_REQUIRED);
  });

  it('names the unit first when a listing has neither', async () => {
    const neither = await aDraft({ unit: false, placed: false });

    expect(
      codeOf(await service.submitForReview(partner(), neither).catch((e: unknown) => e)),
    ).toBe(ERROR.PROPERTY_UNIT_REQUIRED);
  });

  it('refuses a listing with no photograph', async () => {
    const reference = await aDraft({ unit: true, placed: true, photograph: false });

    expect(
      codeOf(
        await service.submitForReview(partner(), reference).catch((e: unknown) => e),
      ),
    ).toBe(ERROR.PROPERTY_PHOTOGRAPH_REQUIRED);
  });

  /**
   * A photograph still PROCESSING is not a photograph.
   *
   * `imageIsPublished` restricts to `status = 'ready'`, and the gate must honour it — otherwise a
   * partner uploads, submits within the render window, and a listing reaches review with nothing
   * to show. Planted rather than looked for: the fixture's image is ready by construction.
   */
  it('refuses a listing whose only photograph has not finished processing', async () => {
    const reference = await aDraft({ unit: true, placed: true });

    await db.execute(sql`
      UPDATE property_images SET status = 'processing'
      WHERE property_id = (SELECT id FROM properties WHERE reference = ${reference})
    `);

    expect(
      codeOf(
        await service.submitForReview(partner(), reference).catch((e: unknown) => e),
      ),
    ).toBe(ERROR.PROPERTY_PHOTOGRAPH_REQUIRED);
  });

  it('refuses a listing with no Arabic description', async () => {
    const reference = await aDraft({ unit: true, placed: true, described: false });

    expect(
      codeOf(
        await service.submitForReview(partner(), reference).catch((e: unknown) => e),
      ),
    ).toBe(ERROR.PROPERTY_DESCRIPTION_REQUIRED);
  });

  it('treats a description of only whitespace as none', async () => {
    const reference = await aDraft({ unit: true, placed: true });

    await db.execute(
      sql`UPDATE properties SET description_ar = '   ' WHERE reference = ${reference}`,
    );

    expect(
      codeOf(
        await service.submitForReview(partner(), reference).catch((e: unknown) => e),
      ),
    ).toBe(ERROR.PROPERTY_DESCRIPTION_REQUIRED);
  });

  /**
   * The ORDER, across all four.
   *
   * A listing missing everything is refused for the UNIT — the check `LISTING_READINESS_CHECKS`
   * puts first because it is the only one that makes a listing unreachable. The screen shows all
   * four at once regardless, so whichever the API names the reader has seen every one; this pins
   * the order so the two consoles and the gate cannot start disagreeing about what matters most.
   */
  it('names the worst missing requirement when several are', async () => {
    const reference = await aDraft({
      unit: false,
      placed: false,
      photograph: false,
      described: false,
    });

    expect(
      codeOf(
        await service.submitForReview(partner(), reference).catch((e: unknown) => e),
      ),
    ).toBe(ERROR.PROPERTY_UNIT_REQUIRED);
  });

  it('accepts a listing that meets all four', async () => {
    const reference = await aDraft({
      unit: true,
      placed: true,
      photograph: true,
      described: true,
    });
    const result = await service.submitForReview(partner(), reference);

    expect(result.status).toBe('pending_review');
  });

  /**
   * Half a pair is not a location.
   *
   * The guard reads both columns, and a listing carrying a latitude and no longitude is the state
   * a half-finished write leaves behind. Checked in both directions because a guard written as
   * `!latitude` alone passes one of them.
   */
  it.each([
    ['latitude only', sql`latitude = '33.5123', longitude = NULL`],
    ['longitude only', sql`latitude = NULL, longitude = '36.2988'`],
  ])('refuses a listing carrying %s', async (_name, half) => {
    const reference = await aDraft({ unit: true, placed: true });

    await db.execute(sql`UPDATE properties SET ${half} WHERE reference = ${reference}`);

    expect(
      codeOf(
        await service.submitForReview(partner(), reference).catch((e: unknown) => e),
      ),
    ).toBe(ERROR.PROPERTY_LOCATION_REQUIRED);
  });
});
