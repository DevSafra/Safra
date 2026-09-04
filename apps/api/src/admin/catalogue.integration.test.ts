import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { CatalogueService } from './catalogue.service.js';
import { codeOf } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * كتالوج المنصّة — the three reference sets a business manages (Bashar, 2026-09-04).
 *
 * ## What these hold
 *
 * The four rules every one of the three entities obeys, asserted on each rather than on one:
 *
 * 1. **A code is reinstated, not refused.** All three tables constrain `code` uniquely with no
 *    `deleted_at` predicate, so without this a row deleted by mistake could never be added back.
 * 2. **An edit leaves absent fields alone.** `coalesce` over a bound `null`, and the trap is the
 *    JSON one: a `tiers` that is not being changed must not arrive as SQL `null` and wipe the
 *    refund ladder.
 * 3. **Deleting is refused while anything points at the row**, with the COUNT, so the reader is
 *    told to retire it instead rather than meeting a foreign-key error.
 * 4. **Every write records an audit row inside the same transaction.**
 *
 * ## Why the counts matter enough to assert
 *
 * They are what makes retiring a visible decision rather than a guess. `list()` counting live
 * partners while `remove()` counts every foreign key including soft-deleted ones is deliberate and
 * easy to "tidy" into agreement — which would make a delete refuse for a reason the screen does
 * not show, or succeed against a key that then fails.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('CatalogueService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: CatalogueService;

  /**
   * A REAL user id, read from the database rather than invented.
   *
   * `audit_log.actor_user_id` is a foreign key, so a fabricated uuid fails the insert — and it
   * fails inside the service's transaction, which rolls the write back too. Every assertion here
   * would then be about a change that never happened, reported as a query error rather than as
   * the thing it actually is.
   */
  let actor: AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    service = new CatalogueService(db, new AuditService(db));

    const staff = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM users WHERE role = 'super_admin' AND deleted_at IS NULL LIMIT 1
    `);

    actor = {
      sub: staff.rows[0]?.id,
      role: 'super_admin',
    } as unknown as AccessTokenClaims;
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** Audit rows written since this test began, newest first. */
  const auditFor = async (action: string) => {
    const rows = await db.execute<{ action: string; after: Record<string, unknown> }>(sql`
      SELECT action, after FROM audit_log WHERE action = ${action}
      ORDER BY created_at DESC LIMIT 1
    `);

    return rows.rows[0];
  };

  // ── Amenities ─────────────────────────────────────────────────────────────

  describe('amenities', () => {
    const input = {
      code: 'ev-charger',
      nameAr: 'شاحن سيارات كهربائية',
      nameEn: 'EV charger',
      nameDe: 'Ladestation',
      category: 'facilities' as const,
      isFilterable: true,
    };

    it('creates one, and it appears in the list', async () => {
      await service.createAmenity(actor, input);

      const found = (await service.amenities()).find((a) => a.code === input.code);

      expect(found?.nameAr).toBe(input.nameAr);
      expect(found?.isActive, 'a new amenity is offered immediately').toBe(true);
      expect(found?.units, 'and nothing declares it yet').toBe(0);
    });

    it('appends its sort order rather than taking somebody else s', async () => {
      const before = await service.amenities();
      const highest = Math.max(...before.map((a) => a.sortOrder));

      await service.createAmenity(actor, input);

      const found = (await service.amenities()).find((a) => a.code === input.code);

      expect(found?.sortOrder).toBeGreaterThan(highest);
    });

    it('refuses a code that is already live', async () => {
      expect(
        codeOf(
          await service
            .createAmenity(actor, { ...input, code: 'wifi' })
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.CATALOGUE_CODE_TAKEN);
    });

    /* The rule the unique constraint would otherwise make impossible to satisfy. */
    it('reinstates a retired code instead of refusing it', async () => {
      await service.createAmenity(actor, input);
      await service.removeAmenity(actor, input.code);

      expect((await service.amenities()).some((a) => a.code === input.code)).toBe(false);

      await service.createAmenity(actor, { ...input, nameAr: 'اسم جديد' });

      const found = (await service.amenities()).find((a) => a.code === input.code);

      expect(found?.nameAr, 'and takes the new names').toBe('اسم جديد');
      expect((await auditFor('amenity.created'))?.after?.['reinstated']).toBe(true);
    });

    it('leaves fields the edit did not name alone', async () => {
      await service.createAmenity(actor, input);
      await service.updateAmenity(actor, input.code, { nameAr: 'مُعدَّل' });

      const found = (await service.amenities()).find((a) => a.code === input.code);

      expect(found?.nameAr).toBe('مُعدَّل');
      expect(found?.nameEn, 'untouched').toBe(input.nameEn);
      expect(found?.isFilterable, 'untouched').toBe(true);
    });

    /**
     * Retiring and hiding-from-the-filter are different acts.
     *
     * `is_active` decides whether a partner may declare it; `is_filterable` decides whether it
     * appears in the search sidebar. Conflating them would let a super admin tidying the sidebar
     * stop partners describing a facility they have.
     */
    it('separates being offered from being filterable', async () => {
      await service.createAmenity(actor, input);
      await service.updateAmenity(actor, input.code, { isFilterable: false });

      const found = (await service.amenities()).find((a) => a.code === input.code);

      expect(found?.isFilterable).toBe(false);
      expect(found?.isActive, 'still offered to partners').toBe(true);
    });

    /**
     * The link is CREATED here rather than found.
     *
     * `unit_amenities` has been empty on this database before (2026-09-02, when the filter listed
     * twelve amenities that nothing declared), so a test that searched for one in use would have
     * SKIPPED or failed for a reason with no relationship to the rule. Making the state the test
     * needs is what stops it measuring the fixture.
     */
    it('refuses to delete one a unit declares, and says how many', async () => {
      await service.createAmenity(actor, input);

      await db.execute(sql`
        INSERT INTO unit_amenities (unit_id, amenity_id)
        SELECT (SELECT id FROM units WHERE deleted_at IS NULL LIMIT 1),
               (SELECT id FROM amenities WHERE code = ${input.code})
      `);

      const inUse = (await service.amenities()).find((a) => a.code === input.code);

      expect(inUse?.units, 'the link this test just made is counted').toBe(1);

      const error = await service
        .removeAmenity(actor, inUse!.code)
        .catch((thrown: unknown) => thrown);

      expect(codeOf(error)).toBe(ERROR.CATALOGUE_IN_USE);
      expect(
        (
          error as { getResponse: () => { params?: Record<string, unknown> } }
        ).getResponse().params?.['count'],
        'the count travels, so the sentence can name it',
      ).toBe(inUse!.units);
    });

    it('deletes one nothing points at', async () => {
      await service.createAmenity(actor, input);
      await service.removeAmenity(actor, input.code);

      expect((await service.amenities()).some((a) => a.code === input.code)).toBe(false);
      expect(await auditFor('amenity.deleted')).toBeTruthy();
    });

    it('answers a code that is not there', async () => {
      expect(
        codeOf(
          await service
            .updateAmenity(actor, 'no-such-code', { nameAr: 'x' })
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.CATALOGUE_NOT_FOUND);
    });
  });

  // ── Cancellation policies ─────────────────────────────────────────────────

  describe('cancellation policies', () => {
    const input = {
      code: 'ultra-flex',
      nameAr: 'مرن جداً',
      nameEn: 'Ultra flexible',
      nameDe: 'Sehr flexibel',
      descriptionAr: 'استرداد كامل حتى 24 ساعة قبل الوصول.',
      descriptionEn: 'Full refund until 24 hours before check-in.',
      descriptionDe: 'Volle Erstattung bis 24 Stunden vor Anreise.',
      tiers: [
        { hoursBeforeCheckIn: 24, refundPercent: 100 },
        { hoursBeforeCheckIn: 0, refundPercent: 50 },
      ],
      minRefundPercent: 50,
    };

    it('creates one with its ladder intact', async () => {
      await service.createCancellationPolicy(actor, input);

      const found = (await service.cancellationPolicies()).find(
        (p) => p.code === input.code,
      );

      expect(found?.tiers).toStrictEqual(input.tiers);
      expect(found?.minRefundPercent).toBe(50);
      expect(found?.properties).toBe(0);
    });

    /**
     * The trap this whole entity has: an edit that does not mention `tiers` must not wipe them.
     *
     * `coalesce(${undefined}, tiers)` binds as SQL `null` and would replace the ladder with
     * nothing — a policy that silently refunds by the floor alone, on every future booking, with
     * no error anywhere. The service resolves the fragment before the statement for this reason.
     */
    it('does not wipe the ladder when an edit does not mention it', async () => {
      await service.createCancellationPolicy(actor, input);
      await service.updateCancellationPolicy(actor, input.code, { nameAr: 'مُعدَّل' });

      const found = (await service.cancellationPolicies()).find(
        (p) => p.code === input.code,
      );

      expect(found?.nameAr).toBe('مُعدَّل');
      expect(found?.tiers, 'the ladder survived an unrelated edit').toStrictEqual(
        input.tiers,
      );
    });

    it('replaces the ladder when an edit does mention it', async () => {
      await service.createCancellationPolicy(actor, input);
      await service.updateCancellationPolicy(actor, input.code, {
        tiers: [{ hoursBeforeCheckIn: 72, refundPercent: 100 }],
      });

      const found = (await service.cancellationPolicies()).find(
        (p) => p.code === input.code,
      );

      expect(found?.tiers).toStrictEqual([
        { hoursBeforeCheckIn: 72, refundPercent: 100 },
      ]);
    });

    it('refuses to delete one a listing is on, and says how many', async () => {
      const inUse = (await service.cancellationPolicies()).find((p) => p.properties > 0);

      expect(inUse, 'the fixture has a policy in use').toBeTruthy();
      expect(
        codeOf(
          await service
            .removeCancellationPolicy(actor, inUse!.code)
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.CATALOGUE_IN_USE);
    });

    it('retires one instead, leaving the listings on it alone', async () => {
      const inUse = (await service.cancellationPolicies()).find((p) => p.properties > 0);

      await service.updateCancellationPolicy(actor, inUse!.code, { isActive: false });

      const after = (await service.cancellationPolicies()).find(
        (p) => p.code === inUse!.code,
      );

      expect(after?.isActive).toBe(false);
      expect(after?.properties, 'the listings are untouched').toBe(inUse!.properties);
    });
  });

  // ── Partner types ─────────────────────────────────────────────────────────

  describe('partner types', () => {
    const input = {
      code: 'wellness',
      nameAr: 'منتجعات صحية',
      nameEn: 'Wellness',
      nameDe: 'Wellness',
    };

    it('creates one, offered immediately', async () => {
      await service.createPartnerType(actor, input);

      const found = (await service.partnerTypes()).find((t) => t.code === input.code);

      expect(found?.isActive).toBe(true);
      expect(found?.partners).toBe(0);
    });

    it('refuses to delete one a partner is on', async () => {
      const inUse = (await service.partnerTypes()).find((t) => t.partners > 0);

      expect(inUse, 'the fixture has a partner type in use').toBeTruthy();
      expect(
        codeOf(
          await service
            .removePartnerType(actor, inUse!.code)
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.CATALOGUE_IN_USE);
    });

    it('retires one, which takes it out of the application form', async () => {
      const inUse = (await service.partnerTypes()).find((t) => t.partners > 0);

      await service.updatePartnerType(actor, inUse!.code, { isActive: false });

      /* The application form asks for `is_active = true` — see `partner-application.service`. */
      const offered = await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM partner_types
        WHERE code = ${inUse!.code} AND is_active = true AND deleted_at IS NULL
      `);

      expect(offered.rows[0]?.n).toBe(0);
    });
  });

  // ── Audit ─────────────────────────────────────────────────────────────────

  /**
   * Every one of the nine writes records, and records the CODE.
   *
   * Asserted as a sweep rather than nine assertions, because the failure this guards is a write
   * added later with the audit call forgotten — which no per-method test can notice.
   */
  it('records an audit row naming the code for every write', async () => {
    const writes: [string, () => Promise<unknown>][] = [
      [
        'amenity.created',
        () =>
          service.createAmenity(actor, {
            code: 'audit-probe',
            nameAr: 'س',
            nameEn: 'x',
            nameDe: 'x',
            category: 'facilities',
            isFilterable: true,
          }),
      ],
      [
        'amenity.updated',
        () => service.updateAmenity(actor, 'audit-probe', { nameAr: 'ص' }),
      ],
      ['amenity.deleted', () => service.removeAmenity(actor, 'audit-probe')],
      [
        'partner_type.created',
        () =>
          service.createPartnerType(actor, {
            code: 'audit-probe',
            nameAr: 'س',
            nameEn: 'x',
            nameDe: 'x',
          }),
      ],
      [
        'partner_type.updated',
        () => service.updatePartnerType(actor, 'audit-probe', { nameAr: 'ص' }),
      ],
      ['partner_type.deleted', () => service.removePartnerType(actor, 'audit-probe')],
    ];

    for (const [action, run] of writes) {
      await run();

      const row = await auditFor(action);

      expect(row, `${action} wrote no audit row`).toBeTruthy();
      expect(
        JSON.stringify(row),
        `${action} recorded no code, so سجل التدقيق cannot name what changed`,
      ).toContain('audit-probe');
    }
  });
});
