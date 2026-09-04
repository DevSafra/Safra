import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  type AmenityCreateInput,
  type AmenityUpdateInput,
  type CancellationPolicyCreateInput,
  type CancellationPolicyUpdateInput,
  type PartnerTypeCreateInput,
  type PartnerTypeUpdateInput,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { conflict, notFound } from '../common/errors/app-error.js';

export interface AmenityRow {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly nameDe: string;
  readonly category: string;
  readonly isFilterable: boolean;
  readonly isActive: boolean;
  readonly sortOrder: number;
  /** Units declaring it — what makes retiring rather than deleting the obvious choice. */
  readonly units: number;
}

export interface CancellationPolicyRow {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly nameDe: string;
  readonly descriptionAr: string;
  readonly descriptionEn: string;
  readonly descriptionDe: string;
  readonly tiers: readonly { hoursBeforeCheckIn: number; refundPercent: number }[];
  readonly minRefundPercent: number;
  readonly isActive: boolean;
  /** Listings on it. Their existing bookings keep a SNAPSHOT and are unaffected by an edit. */
  readonly properties: number;
}

export interface PartnerTypeRow {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly nameDe: string;
  readonly isActive: boolean;
  /** Partners plus outstanding applications — both hold a foreign key to the row. */
  readonly partners: number;
  readonly applications: number;
}

/**
 * كتالوج المنصّة — the three reference sets a business manages (Bashar, 2026-09-04).
 *
 * ## Why this exists
 *
 * `amenities`, `cancellation_policies` and `partner_types` were read across the platform and
 * written nowhere: adding an amenity, renaming a policy or retiring a partner type meant SQL
 * against production. Bashar: *"I do not want normal business operations to depend on direct SQL
 * or migrations where an administrator should reasonably be able to manage the data through the
 * platform."*
 *
 * ## One service, three entities, one set of rules
 *
 * They differ in their columns and in nothing else that matters. Each is created by code (or
 * REINSTATED if that code was retired), edited by `coalesce` so an absent field is left alone,
 * retired with `isActive`, and deleted only when nothing points at it. Three services would be
 * three chances to make those four decisions differently — which is how `remove` came to mean
 * "hard delete" on one screen and "retire" on another elsewhere in this codebase.
 *
 * ## Every write is audited inside its own transaction
 *
 * Same shape as `GeoCategoryService`: the audit row and the change land together or neither does,
 * and the controller carries `@AuditExempt` because the recording happens here.
 *
 * ## What editing a policy does NOT do
 *
 * `bookings.cancellation_policy_snapshot` holds the tiers and floor a booking was created under,
 * and `refund.service.ts` reads the SNAPSHOT. So an edit moves future bookings only. That is the
 * point of snapshotting, and the screen says so — a super admin who believes they have just
 * changed the refund owed on a live booking would be wrong in an expensive direction.
 */
@Injectable()
export class CatalogueService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ── Amenities ─────────────────────────────────────────────────────────────

  async amenities(): Promise<AmenityRow[]> {
    const result = await this.db.execute<{
      code: string;
      name_ar: string;
      name_en: string;
      name_de: string;
      category: string;
      is_filterable: boolean;
      is_active: boolean;
      sort_order: number;
      units: number;
    }>(sql`
      SELECT a.code, a.name_ar, a.name_en, a.name_de, a.category,
             a.is_filterable, a.is_active, a.sort_order,
             (SELECT count(*)::int FROM unit_amenities ua WHERE ua.amenity_id = a.id) AS units
      FROM amenities a
      WHERE a.deleted_at IS NULL
      ORDER BY a.category, a.sort_order, a.code
    `);

    return result.rows.map((row) => ({
      code: row.code,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      nameDe: row.name_de,
      category: row.category,
      isFilterable: row.is_filterable,
      isActive: row.is_active,
      sortOrder: row.sort_order,
      units: row.units,
    }));
  }

  async createAmenity(
    actor: AccessTokenClaims | undefined,
    input: AmenityCreateInput,
  ): Promise<{ code: string }> {
    const existing = await this.codeState('amenities', input.code);

    if (existing === 'live') throw conflict(ERROR.CATALOGUE_CODE_TAKEN);

    await this.db.transaction(async (tx) => {
      if (existing === 'retired') {
        await tx.execute(sql`
          UPDATE amenities SET
            name_ar = ${input.nameAr}, name_en = ${input.nameEn}, name_de = ${input.nameDe},
            category = ${input.category}, is_filterable = ${input.isFilterable},
            is_active = true, deleted_at = NULL, updated_at = now()
          WHERE code = ${input.code}
        `);
      } else {
        /* Appended. Taking somebody else's number would silently reorder the search sidebar. */
        await tx.execute(sql`
          INSERT INTO amenities (code, name_ar, name_en, name_de, category, is_filterable, sort_order)
          VALUES (${input.code}, ${input.nameAr}, ${input.nameEn}, ${input.nameDe},
                  ${input.category}, ${input.isFilterable},
                  (SELECT coalesce(max(sort_order), 0) + 1 FROM amenities))
        `);
      }

      await this.record(tx, actor, 'amenity.created', 'amenity', undefined, {
        code: input.code,
        nameAr: input.nameAr,
        category: input.category,
        reinstated: existing === 'retired',
      });
    });

    return { code: input.code };
  }

  async updateAmenity(
    actor: AccessTokenClaims | undefined,
    code: string,
    input: AmenityUpdateInput,
  ): Promise<{ code: string }> {
    const before = await this.db.execute<{
      id: string;
      name_ar: string;
      is_active: boolean;
      is_filterable: boolean;
      units: number;
    }>(sql`
      SELECT a.id::text, a.name_ar, a.is_active, a.is_filterable,
             (SELECT count(*)::int FROM unit_amenities ua WHERE ua.amenity_id = a.id) AS units
      FROM amenities a WHERE a.code = ${code} AND a.deleted_at IS NULL LIMIT 1
    `);

    const row = before.rows[0];

    if (!row) throw notFound(ERROR.CATALOGUE_NOT_FOUND);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE amenities SET
          name_ar       = coalesce(${input.nameAr ?? null}, name_ar),
          name_en       = coalesce(${input.nameEn ?? null}, name_en),
          name_de       = coalesce(${input.nameDe ?? null}, name_de),
          category      = coalesce(${input.category ?? null}, category),
          is_filterable = coalesce(${input.isFilterable ?? null}, is_filterable),
          is_active     = coalesce(${input.isActive ?? null}, is_active),
          sort_order    = coalesce(${input.sortOrder ?? null}, sort_order),
          updated_at    = now()
        WHERE id = ${row.id}::uuid
      `);

      await this.record(
        tx,
        actor,
        'amenity.updated',
        'amenity',
        {
          code,
          nameAr: row.name_ar,
          isActive: row.is_active,
          isFilterable: row.is_filterable,
        },
        /* The count travels: retiring one that 4,000 units declare is the consequential act. */
        { code, ...input, units: row.units },
      );
    });

    return { code };
  }

  async removeAmenity(
    actor: AccessTokenClaims | undefined,
    code: string,
  ): Promise<{ code: string }> {
    const found = await this.db.execute<{
      id: string;
      name_ar: string;
      links: number;
    }>(sql`
      SELECT a.id::text, a.name_ar,
             (SELECT count(*)::int FROM unit_amenities ua WHERE ua.amenity_id = a.id) AS links
      FROM amenities a WHERE a.code = ${code} AND a.deleted_at IS NULL LIMIT 1
    `);

    const row = found.rows[0];

    if (!row) throw notFound(ERROR.CATALOGUE_NOT_FOUND);
    if (row.links > 0) throw conflict(ERROR.CATALOGUE_IN_USE, { count: row.links });

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE amenities SET deleted_at = now(), updated_at = now()
        WHERE id = ${row.id}::uuid
      `);

      /*
        The code in BOTH halves, as the geography deletes record it. A reader of سجل التدقيق may
        look at either side, and a delete whose `after` is empty reads as a row that lost its
        payload rather than one that was removed.
      */
      await this.record(
        tx,
        actor,
        'amenity.deleted',
        'amenity',
        { code, nameAr: row.name_ar },
        { code },
      );
    });

    return { code };
  }

  // ── Cancellation policies ─────────────────────────────────────────────────

  async cancellationPolicies(): Promise<CancellationPolicyRow[]> {
    const result = await this.db.execute<{
      code: string;
      name_ar: string;
      name_en: string;
      name_de: string;
      description_ar: string;
      description_en: string;
      description_de: string;
      tiers: { hoursBeforeCheckIn: number; refundPercent: number }[];
      min_refund_percent: number;
      is_active: boolean;
      properties: number;
    }>(sql`
      SELECT cp.code, cp.name_ar, cp.name_en, cp.name_de,
             cp.description_ar, cp.description_en, cp.description_de,
             cp.tiers, cp.min_refund_percent, cp.is_active,
             (SELECT count(*)::int FROM properties p
               WHERE p.cancellation_policy_id = cp.id AND p.deleted_at IS NULL) AS properties
      FROM cancellation_policies cp
      WHERE cp.deleted_at IS NULL
      ORDER BY cp.code
    `);

    return result.rows.map((row) => ({
      code: row.code,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      nameDe: row.name_de,
      descriptionAr: row.description_ar,
      descriptionEn: row.description_en,
      descriptionDe: row.description_de,
      tiers: row.tiers ?? [],
      minRefundPercent: row.min_refund_percent,
      isActive: row.is_active,
      properties: row.properties,
    }));
  }

  async createCancellationPolicy(
    actor: AccessTokenClaims | undefined,
    input: CancellationPolicyCreateInput,
  ): Promise<{ code: string }> {
    const existing = await this.codeState('cancellation_policies', input.code);

    if (existing === 'live') throw conflict(ERROR.CATALOGUE_CODE_TAKEN);

    const tiers = JSON.stringify(input.tiers);

    await this.db.transaction(async (tx) => {
      if (existing === 'retired') {
        await tx.execute(sql`
          UPDATE cancellation_policies SET
            name_ar = ${input.nameAr}, name_en = ${input.nameEn}, name_de = ${input.nameDe},
            description_ar = ${input.descriptionAr}, description_en = ${input.descriptionEn},
            description_de = ${input.descriptionDe},
            tiers = ${tiers}::jsonb, min_refund_percent = ${input.minRefundPercent},
            is_active = true, deleted_at = NULL, updated_at = now()
          WHERE code = ${input.code}
        `);
      } else {
        await tx.execute(sql`
          INSERT INTO cancellation_policies
            (code, name_ar, name_en, name_de, description_ar, description_en, description_de,
             tiers, min_refund_percent)
          VALUES (${input.code}, ${input.nameAr}, ${input.nameEn}, ${input.nameDe},
                  ${input.descriptionAr}, ${input.descriptionEn}, ${input.descriptionDe},
                  ${tiers}::jsonb, ${input.minRefundPercent})
        `);
      }

      await this.record(
        tx,
        actor,
        'cancellation_policy.created',
        'cancellation_policy',
        undefined,
        {
          code: input.code,
          nameAr: input.nameAr,
          minRefundPercent: input.minRefundPercent,
          tiers: input.tiers.length,
          reinstated: existing === 'retired',
        },
      );
    });

    return { code: input.code };
  }

  async updateCancellationPolicy(
    actor: AccessTokenClaims | undefined,
    code: string,
    input: CancellationPolicyUpdateInput,
  ): Promise<{ code: string }> {
    const before = await this.db.execute<{
      id: string;
      name_ar: string;
      is_active: boolean;
      min_refund_percent: number;
      properties: number;
    }>(sql`
      SELECT cp.id::text, cp.name_ar, cp.is_active, cp.min_refund_percent,
             (SELECT count(*)::int FROM properties p
               WHERE p.cancellation_policy_id = cp.id AND p.deleted_at IS NULL) AS properties
      FROM cancellation_policies cp
      WHERE cp.code = ${code} AND cp.deleted_at IS NULL LIMIT 1
    `);

    const row = before.rows[0];

    if (!row) throw notFound(ERROR.CATALOGUE_NOT_FOUND);

    /*
      `jsonb` or NULL, resolved before the statement. A `coalesce` over an inlined `undefined`
      would bind as null and silently wipe the ladder — the one field here where "leave it alone"
      and "set it to nothing" are both expressible and mean very different things.
    */
    const tiers: SQL | null =
      input.tiers === undefined ? null : sql`${JSON.stringify(input.tiers)}::jsonb`;

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE cancellation_policies SET
          name_ar            = coalesce(${input.nameAr ?? null}, name_ar),
          name_en            = coalesce(${input.nameEn ?? null}, name_en),
          name_de            = coalesce(${input.nameDe ?? null}, name_de),
          description_ar     = coalesce(${input.descriptionAr ?? null}, description_ar),
          description_en     = coalesce(${input.descriptionEn ?? null}, description_en),
          description_de     = coalesce(${input.descriptionDe ?? null}, description_de),
          tiers              = coalesce(${tiers}, tiers),
          min_refund_percent = coalesce(${input.minRefundPercent ?? null}, min_refund_percent),
          is_active          = coalesce(${input.isActive ?? null}, is_active),
          updated_at         = now()
        WHERE id = ${row.id}::uuid
      `);

      await this.record(
        tx,
        actor,
        'cancellation_policy.updated',
        'cancellation_policy',
        {
          code,
          nameAr: row.name_ar,
          isActive: row.is_active,
          minRefundPercent: row.min_refund_percent,
        },
        {
          code,
          ...input,
          ...(input.tiers ? { tiers: input.tiers.length } : {}),
          properties: row.properties,
        },
      );
    });

    return { code };
  }

  async removeCancellationPolicy(
    actor: AccessTokenClaims | undefined,
    code: string,
  ): Promise<{ code: string }> {
    const found = await this.db.execute<{
      id: string;
      name_ar: string;
      links: number;
    }>(sql`
      SELECT cp.id::text, cp.name_ar,
             (SELECT count(*)::int FROM properties p WHERE p.cancellation_policy_id = cp.id) AS links
      FROM cancellation_policies cp
      WHERE cp.code = ${code} AND cp.deleted_at IS NULL LIMIT 1
    `);

    const row = found.rows[0];

    if (!row) throw notFound(ERROR.CATALOGUE_NOT_FOUND);
    if (row.links > 0) throw conflict(ERROR.CATALOGUE_IN_USE, { count: row.links });

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE cancellation_policies SET deleted_at = now(), updated_at = now()
        WHERE id = ${row.id}::uuid
      `);

      /*
        The code in BOTH halves, as the geography deletes record it. A reader of سجل التدقيق may
        look at either side, and a delete whose `after` is empty reads as a row that lost its
        payload rather than one that was removed.
      */
      await this.record(
        tx,
        actor,
        'cancellation_policy.deleted',
        'cancellation_policy',
        { code, nameAr: row.name_ar },
        { code },
      );
    });

    return { code };
  }

  // ── Partner types ─────────────────────────────────────────────────────────

  async partnerTypes(): Promise<PartnerTypeRow[]> {
    const result = await this.db.execute<{
      code: string;
      name_ar: string;
      name_en: string;
      name_de: string;
      is_active: boolean;
      partners: number;
      applications: number;
    }>(sql`
      SELECT pt.code, pt.name_ar, pt.name_en, pt.name_de, pt.is_active,
             (SELECT count(*)::int FROM partners p
               WHERE p.partner_type_id = pt.id AND p.deleted_at IS NULL) AS partners,
             (SELECT count(*)::int FROM partner_applications pa
               WHERE pa.partner_type_id = pt.id) AS applications
      FROM partner_types pt
      WHERE pt.deleted_at IS NULL
      ORDER BY pt.code
    `);

    return result.rows.map((row) => ({
      code: row.code,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      nameDe: row.name_de,
      isActive: row.is_active,
      partners: row.partners,
      applications: row.applications,
    }));
  }

  async createPartnerType(
    actor: AccessTokenClaims | undefined,
    input: PartnerTypeCreateInput,
  ): Promise<{ code: string }> {
    const existing = await this.codeState('partner_types', input.code);

    if (existing === 'live') throw conflict(ERROR.CATALOGUE_CODE_TAKEN);

    await this.db.transaction(async (tx) => {
      if (existing === 'retired') {
        await tx.execute(sql`
          UPDATE partner_types SET
            name_ar = ${input.nameAr}, name_en = ${input.nameEn}, name_de = ${input.nameDe},
            is_active = true, deleted_at = NULL, updated_at = now()
          WHERE code = ${input.code}
        `);
      } else {
        await tx.execute(sql`
          INSERT INTO partner_types (code, name_ar, name_en, name_de)
          VALUES (${input.code}, ${input.nameAr}, ${input.nameEn}, ${input.nameDe})
        `);
      }

      await this.record(tx, actor, 'partner_type.created', 'partner_type', undefined, {
        code: input.code,
        nameAr: input.nameAr,
        reinstated: existing === 'retired',
      });
    });

    return { code: input.code };
  }

  async updatePartnerType(
    actor: AccessTokenClaims | undefined,
    code: string,
    input: PartnerTypeUpdateInput,
  ): Promise<{ code: string }> {
    const before = await this.db.execute<{
      id: string;
      name_ar: string;
      is_active: boolean;
      partners: number;
    }>(sql`
      SELECT pt.id::text, pt.name_ar, pt.is_active,
             (SELECT count(*)::int FROM partners p
               WHERE p.partner_type_id = pt.id AND p.deleted_at IS NULL) AS partners
      FROM partner_types pt WHERE pt.code = ${code} AND pt.deleted_at IS NULL LIMIT 1
    `);

    const row = before.rows[0];

    if (!row) throw notFound(ERROR.CATALOGUE_NOT_FOUND);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE partner_types SET
          name_ar    = coalesce(${input.nameAr ?? null}, name_ar),
          name_en    = coalesce(${input.nameEn ?? null}, name_en),
          name_de    = coalesce(${input.nameDe ?? null}, name_de),
          is_active  = coalesce(${input.isActive ?? null}, is_active),
          updated_at = now()
        WHERE id = ${row.id}::uuid
      `);

      await this.record(
        tx,
        actor,
        'partner_type.updated',
        'partner_type',
        { code, nameAr: row.name_ar, isActive: row.is_active },
        { code, ...input, partners: row.partners },
      );
    });

    return { code };
  }

  async removePartnerType(
    actor: AccessTokenClaims | undefined,
    code: string,
  ): Promise<{ code: string }> {
    /*
      Applications count too, and they are counted WITHOUT a `deleted_at` filter: the foreign key
      is what refuses the delete, and it does not care whether the row is soft-deleted. `list()`
      counts live partners, which is the right figure for a person to read and the wrong one for
      deciding whether a row can go.
    */
    const found = await this.db.execute<{
      id: string;
      name_ar: string;
      links: number;
    }>(sql`
      SELECT pt.id::text, pt.name_ar,
             (SELECT count(*)::int FROM partners p WHERE p.partner_type_id = pt.id)
             + (SELECT count(*)::int FROM partner_applications pa WHERE pa.partner_type_id = pt.id)
             AS links
      FROM partner_types pt WHERE pt.code = ${code} AND pt.deleted_at IS NULL LIMIT 1
    `);

    const row = found.rows[0];

    if (!row) throw notFound(ERROR.CATALOGUE_NOT_FOUND);
    if (row.links > 0) throw conflict(ERROR.CATALOGUE_IN_USE, { count: row.links });

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE partner_types SET deleted_at = now(), updated_at = now()
        WHERE id = ${row.id}::uuid
      `);

      /*
        The code in BOTH halves, as the geography deletes record it. A reader of سجل التدقيق may
        look at either side, and a delete whose `after` is empty reads as a row that lost its
        payload rather than one that was removed.
      */
      await this.record(
        tx,
        actor,
        'partner_type.deleted',
        'partner_type',
        { code, nameAr: row.name_ar },
        { code },
      );
    });

    return { code };
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  /**
   * Whether a code is already taken, and whether by a live row or a retired one.
   *
   * All three tables constrain `code` uniquely with NO `deleted_at` predicate, so a code deleted
   * by mistake could never be added back — the insert would collide with the tombstone and the
   * screen would say «الرمز مستخدم» about something the reader cannot see. The caller reinstates
   * instead, which is what `createCountry` and `createCityCategory` already do.
   *
   * The table name is INTERPOLATED, so it must never come from a request: it is one of three
   * literals written at the three call sites, never a parameter this service is handed.
   */
  private async codeState(
    table: 'amenities' | 'cancellation_policies' | 'partner_types',
    code: string,
  ): Promise<'live' | 'retired' | undefined> {
    const identifier =
      table === 'amenities'
        ? sql`amenities`
        : table === 'cancellation_policies'
          ? sql`cancellation_policies`
          : sql`partner_types`;

    const result = await this.db.execute<{ retired: boolean }>(sql`
      SELECT (deleted_at IS NOT NULL) AS retired FROM ${identifier}
      WHERE code = ${code} LIMIT 1
    `);

    const row = result.rows[0];

    if (!row) return undefined;

    return row.retired ? 'retired' : 'live';
  }

  /** One audit call, so all twelve writes record the same way and none can forget. */
  private async record(
    tx: unknown,
    actor: AccessTokenClaims | undefined,
    action: string,
    subjectType: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(
      {
        actorUserId: actor?.sub,
        actorRole: actor?.role,
        action,
        subjectType,
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
      },
      tx as Database,
    );
  }
}
