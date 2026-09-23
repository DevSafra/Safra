import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  COUNT_CAP,
  ERROR,
  LANDMARK_MAX_KM_FROM_CITY,
  distanceMetres,
  type CreateLandmarkInput,
  type CreateLandmarkKindInput,
  type UpdateLandmarkInput,
  type UpdateLandmarkKindInput,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';

export interface LandmarkKindRow {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly nameDe: string;
  readonly iconPaths: readonly string[];
  readonly isActive: boolean;
  readonly sortOrder: number;
  /** Live landmarks filed under it — what makes retiring one a visible decision. */
  readonly landmarks: number;
}

export interface LandmarkRow {
  readonly slug: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly nameDe: string;
  readonly citySlug: string;
  readonly cityNameAr: string;
  readonly kindCode: string;
  readonly kindNameAr: string;
  readonly iconPaths: readonly string[];
  readonly latitude: string;
  readonly longitude: string;
  readonly isActive: boolean;
  readonly sortOrder: number;
}

/**
 * المعالم — landmarks and their kinds, managed rather than deployed.
 *
 * ## Why this exists
 *
 * Landmarks shipped on 2026-09-23 as seed data, which satisfied SRS §1.4's «without modifying
 * the code» in the DATA but not in the WORKFLOW: adding a landmark was a seed change, a review
 * and a deployment. Bashar closed that the same day — «I do not want landmarks to remain
 * seed-only data» — and the kinds came with it, because a kind carries the ICON and an icon
 * nobody can change is a code dependency wearing a data costume.
 *
 * ## Nothing is hard-deleted
 *
 * A landmark is referenced by nothing — no booking, no listing — so deleting one would be
 * safe. It is still archived rather than dropped, for a different reason: a distance list a
 * guest saw last week was measured against it, and a support conversation about «it said 800 m
 * from the mosque» needs the row to still exist. `deleted_at` takes it out of every read;
 * `is_active` hides it while leaving it in the registry.
 *
 * A KIND that landmarks still use cannot be archived at all — the foreign key would refuse,
 * and the honest message is «deactivate it» rather than a constraint violation.
 *
 * ## The coordinate check is a typo catch, not a geography lesson
 *
 * Decimal degrees transpose easily, and `36.2, 33.5` instead of `33.5, 36.2` is a plausible
 * pair that lands in Iraq. Every distance on every property page in that city would then be
 * wrong by hundreds of kilometres, silently — the only symptom a guest deciding the site is
 * broken. `LANDMARK_MAX_KM_FROM_CITY` is loose enough for an airport an hour out of town and
 * tight enough that a swapped pair cannot survive it.
 */
@Injectable()
export class LandmarkService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ── Kinds ────────────────────────────────────────────────────────────────

  /**
   * Every kind, with how many landmarks use it.
   *
   * Unpaginated, and that is the documented exception `geo-bounds.integration.test.ts` holds:
   * a kind is bounded by the business rather than by usage — eight today, and a platform with
   * fifty categories of place has a taxonomy problem rather than a paging problem.
   * `landmark-bounds.integration.test.ts` fails if it outgrows a screen.
   */
  async listKinds(): Promise<LandmarkKindRow[]> {
    const result = await this.db.execute<{
      code: string;
      name_ar: string;
      name_en: string;
      name_de: string;
      icon_paths: string[];
      is_active: boolean;
      sort_order: number;
      landmarks: number;
    }>(sql`
      SELECT k.code, k.name_ar, k.name_en, k.name_de, k.icon_paths,
             k.is_active, k.sort_order,
             (SELECT count(*)::int FROM landmarks l
               WHERE l.kind_id = k.id AND l.deleted_at IS NULL) AS landmarks
      FROM landmark_kinds k
      WHERE k.deleted_at IS NULL
      ORDER BY k.sort_order, k.code
    `);

    return result.rows.map((r) => ({
      code: r.code,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      nameDe: r.name_de,
      /* `text[]` comes back parsed; a null column would be a row written before the default. */
      iconPaths: r.icon_paths ?? [],
      isActive: r.is_active,
      sortOrder: r.sort_order,
      landmarks: r.landmarks,
    }));
  }

  async createKind(
    actor: AccessTokenClaims | undefined,
    input: CreateLandmarkKindInput,
  ): Promise<{ code: string }> {
    /*
      An archived code is reinstated rather than refused — the same reasoning
      `GeoCategoryService.create` records: the unique index has no `deleted_at` predicate on the
      code itself, so without this a kind archived by mistake could never be added back.
    */
    const clash = await this.db.execute<{ retired: boolean }>(sql`
      SELECT (deleted_at IS NOT NULL) AS retired
      FROM landmark_kinds WHERE code = ${input.code} LIMIT 1
    `);
    const existing = clash.rows[0];

    if (existing && !existing.retired) throw conflict(ERROR.GEO_CODE_TAKEN);

    await this.db.transaction(async (tx) => {
      if (existing) {
        await tx.execute(sql`
          UPDATE landmark_kinds SET
            name_ar = ${input.nameAr}, name_en = ${input.nameEn}, name_de = ${input.nameDe},
            icon_paths = ${input.iconPaths}::text[],
            is_active = true, deleted_at = NULL, updated_at = now()
          WHERE code = ${input.code}
        `);
      } else {
        /*
          Appended. `sort_order` decides the order a reader meets these in, and a new kind
          taking somebody else's number would silently reorder every distance list on the site.
        */
        await tx.execute(sql`
          INSERT INTO landmark_kinds (code, name_ar, name_en, name_de, icon_paths, sort_order)
          VALUES (${input.code}, ${input.nameAr}, ${input.nameEn}, ${input.nameDe},
                  ${input.iconPaths}::text[],
                  (SELECT coalesce(max(sort_order), 0) + 1 FROM landmark_kinds))
        `);
      }

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'landmark_kind.created',
          subjectType: 'landmark_kind',
          after: {
            code: input.code,
            nameAr: input.nameAr,
            marks: input.iconPaths.length,
            reinstated: existing !== undefined,
          },
        },
        tx as unknown as Database,
      );
    });

    return { code: input.code };
  }

  async updateKind(
    actor: AccessTokenClaims | undefined,
    code: string,
    input: UpdateLandmarkKindInput,
  ): Promise<{ code: string }> {
    const found = await this.db.execute<{ id: string; name_ar: string }>(sql`
      SELECT id::text, name_ar FROM landmark_kinds
      WHERE code = ${code} AND deleted_at IS NULL LIMIT 1
    `);
    const row = found.rows[0];
    if (!row) throw notFound(ERROR.LANDMARK_KIND_NOT_FOUND);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE landmark_kinds SET
          name_ar    = coalesce(${input.nameAr ?? null}, name_ar),
          name_en    = coalesce(${input.nameEn ?? null}, name_en),
          name_de    = coalesce(${input.nameDe ?? null}, name_de),
          icon_paths = coalesce(${input.iconPaths ?? null}::text[], icon_paths),
          is_active  = coalesce(${input.isActive ?? null}, is_active),
          sort_order = coalesce(${input.sortOrder ?? null}, sort_order),
          updated_at = now()
        WHERE id = ${row.id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'landmark_kind.updated',
          subjectType: 'landmark_kind',
          subjectId: row.id,
          after: { code, ...input },
        },
        tx as unknown as Database,
      );
    });

    return { code };
  }

  /**
   * Archives a kind — refused while any landmark still uses it.
   *
   * The foreign key would refuse anyway; catching it here is what turns a constraint violation
   * into a sentence an operator can act on, and it names the alternative rather than only the
   * problem.
   */
  async archiveKind(
    actor: AccessTokenClaims | undefined,
    code: string,
  ): Promise<{ code: string }> {
    const found = await this.db.execute<{ id: string; used: number }>(sql`
      SELECT k.id::text,
             (SELECT count(*)::int FROM landmarks l
               WHERE l.kind_id = k.id AND l.deleted_at IS NULL) AS used
      FROM landmark_kinds k
      WHERE k.code = ${code} AND k.deleted_at IS NULL LIMIT 1
    `);
    const row = found.rows[0];
    if (!row) throw notFound(ERROR.LANDMARK_KIND_NOT_FOUND);
    if (row.used > 0) throw conflict(ERROR.LANDMARK_KIND_IN_USE);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE landmark_kinds SET is_active = false, deleted_at = now(), updated_at = now()
        WHERE id = ${row.id}::uuid
      `);
      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'landmark_kind.archived',
          subjectType: 'landmark_kind',
          subjectId: row.id,
          after: { code },
        },
        tx as unknown as Database,
      );
    });

    return { code };
  }

  // ── Landmarks ────────────────────────────────────────────────────────────

  /**
   * One page of the registry, optionally filtered by city or kind.
   *
   * `OFFSET` with a capped count, which is the console's documented shape: the bar prints a
   * page NUMBER, and a cursor addresses a position rather than an index. The count and the list
   * share ONE `fromWhere`, so «٤١ نتيجة» cannot drift from the rows under it.
   */
  async list(query: {
    page: number;
    size: number;
    citySlug?: string | undefined;
    kindCode?: string | undefined;
    q?: string | undefined;
  }): Promise<{ items: LandmarkRow[]; total: number; capped: boolean }> {
    const fromWhere = sql`
      FROM landmarks l
      JOIN cities c ON c.id = l.city_id
      JOIN landmark_kinds k ON k.id = l.kind_id
      WHERE l.deleted_at IS NULL
        ${query.citySlug ? sql`AND c.slug = ${query.citySlug}` : sql``}
        ${query.kindCode ? sql`AND k.code = ${query.kindCode}` : sql``}
        ${
          query.q
            ? sql`AND (l.name_ar ILIKE ${'%' + query.q + '%'}
                    OR l.name_en ILIKE ${'%' + query.q + '%'}
                    OR l.slug ILIKE ${'%' + query.q + '%'})`
            : sql``
        }
    `;

    const counted = await this.db.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM (
        SELECT 1 ${fromWhere} LIMIT ${COUNT_CAP + 1}
      ) capped
    `);
    const total = counted.rows[0]?.total ?? 0;

    const rows = await this.db.execute<{
      slug: string;
      name_ar: string;
      name_en: string;
      name_de: string;
      city_slug: string;
      city_name_ar: string;
      kind_code: string;
      kind_name_ar: string;
      icon_paths: string[];
      latitude: string;
      longitude: string;
      is_active: boolean;
      sort_order: number;
    }>(sql`
      SELECT l.slug, l.name_ar, l.name_en, l.name_de,
             c.slug AS city_slug, c.name_ar AS city_name_ar,
             k.code AS kind_code, k.name_ar AS kind_name_ar, k.icon_paths,
             l.latitude::text, l.longitude::text, l.is_active, l.sort_order
      ${fromWhere}
      ORDER BY c.sort_order, c.slug, l.sort_order, l.slug
      LIMIT ${query.size} OFFSET ${(query.page - 1) * query.size}
    `);

    return {
      items: rows.rows.map((r) => ({
        slug: r.slug,
        nameAr: r.name_ar,
        nameEn: r.name_en,
        nameDe: r.name_de,
        citySlug: r.city_slug,
        cityNameAr: r.city_name_ar,
        kindCode: r.kind_code,
        kindNameAr: r.kind_name_ar,
        iconPaths: r.icon_paths ?? [],
        latitude: r.latitude,
        longitude: r.longitude,
        isActive: r.is_active,
        sortOrder: r.sort_order,
      })),
      total: Math.min(total, COUNT_CAP),
      capped: total > COUNT_CAP,
    };
  }

  async create(
    actor: AccessTokenClaims | undefined,
    input: CreateLandmarkInput,
  ): Promise<{ slug: string }> {
    const city = await this.city(input.citySlug);
    const kind = await this.kind(input.kindCode);

    this.assertNearCity(city, input.latitude, input.longitude);

    const clash = await this.db.execute<{ retired: boolean }>(sql`
      SELECT (deleted_at IS NOT NULL) AS retired FROM landmarks
      WHERE city_id = ${city.id}::uuid AND slug = ${input.slug} LIMIT 1
    `);
    const existing = clash.rows[0];
    if (existing && !existing.retired) throw conflict(ERROR.LANDMARK_SLUG_TAKEN);

    await this.db.transaction(async (tx) => {
      if (existing) {
        await tx.execute(sql`
          UPDATE landmarks SET
            kind_id = ${kind.id}::uuid,
            name_ar = ${input.nameAr}, name_en = ${input.nameEn}, name_de = ${input.nameDe},
            latitude = ${input.latitude}::numeric, longitude = ${input.longitude}::numeric,
            is_active = true, deleted_at = NULL, updated_at = now()
          WHERE city_id = ${city.id}::uuid AND slug = ${input.slug}
        `);
      } else {
        await tx.execute(sql`
          INSERT INTO landmarks
            (city_id, kind_id, slug, name_ar, name_en, name_de, latitude, longitude, sort_order)
          VALUES
            (${city.id}::uuid, ${kind.id}::uuid, ${input.slug},
             ${input.nameAr}, ${input.nameEn}, ${input.nameDe},
             ${input.latitude}::numeric, ${input.longitude}::numeric,
             (SELECT coalesce(max(sort_order), 0) + 1 FROM landmarks
               WHERE city_id = ${city.id}::uuid))
        `);
      }

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'landmark.created',
          subjectType: 'landmark',
          after: {
            slug: input.slug,
            citySlug: input.citySlug,
            kindCode: input.kindCode,
            nameAr: input.nameAr,
            reinstated: existing !== undefined,
          },
        },
        tx as unknown as Database,
      );
    });

    return { slug: input.slug };
  }

  async update(
    actor: AccessTokenClaims | undefined,
    slug: string,
    input: UpdateLandmarkInput,
  ): Promise<{ slug: string }> {
    const found = await this.db.execute<{
      id: string;
      city_id: string;
      latitude: string;
      longitude: string;
    }>(sql`
      SELECT id::text, city_id::text, latitude::text, longitude::text
      FROM landmarks WHERE slug = ${slug} AND deleted_at IS NULL LIMIT 1
    `);
    const row = found.rows[0];
    if (!row) throw notFound(ERROR.LANDMARK_NOT_FOUND);

    const city = input.citySlug
      ? await this.city(input.citySlug)
      : await this.cityById(row.city_id);
    const kind = input.kindCode ? await this.kind(input.kindCode) : null;

    /*
      Checked against whatever the row will HOLD, not against what the patch happens to name:
      moving a landmark to another city without touching its coordinates is exactly how a pair
      ends up hundreds of kilometres from the place it is filed under.
    */
    this.assertNearCity(
      city,
      input.latitude ?? row.latitude,
      input.longitude ?? row.longitude,
    );

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE landmarks SET
          city_id   = ${city.id}::uuid,
          kind_id   = coalesce(${kind?.id ?? null}::uuid, kind_id),
          name_ar   = coalesce(${input.nameAr ?? null}, name_ar),
          name_en   = coalesce(${input.nameEn ?? null}, name_en),
          name_de   = coalesce(${input.nameDe ?? null}, name_de),
          latitude  = coalesce(${input.latitude ?? null}::numeric, latitude),
          longitude = coalesce(${input.longitude ?? null}::numeric, longitude),
          is_active = coalesce(${input.isActive ?? null}, is_active),
          sort_order = coalesce(${input.sortOrder ?? null}, sort_order),
          updated_at = now()
        WHERE id = ${row.id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'landmark.updated',
          subjectType: 'landmark',
          subjectId: row.id,
          after: { slug, ...input },
        },
        tx as unknown as Database,
      );
    });

    return { slug };
  }

  async archive(
    actor: AccessTokenClaims | undefined,
    slug: string,
  ): Promise<{ slug: string }> {
    const found = await this.db.execute<{ id: string }>(sql`
      SELECT id::text FROM landmarks WHERE slug = ${slug} AND deleted_at IS NULL LIMIT 1
    `);
    const row = found.rows[0];
    if (!row) throw notFound(ERROR.LANDMARK_NOT_FOUND);

    await this.db.transaction(async (tx) => {
      /*
        Deactivated as well as archived. `deleted_at` already takes it out of every read, but a
        row that is archived and still flagged active is a state nobody can explain, and the
        next person to write a query is the one who finds out which flag they were meant to use.
      */
      await tx.execute(sql`
        UPDATE landmarks SET is_active = false, deleted_at = now(), updated_at = now()
        WHERE id = ${row.id}::uuid
      `);
      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'landmark.archived',
          subjectType: 'landmark',
          subjectId: row.id,
          after: { slug },
        },
        tx as unknown as Database,
      );
    });

    return { slug };
  }

  // ── Lookups ──────────────────────────────────────────────────────────────

  private async city(slug: string) {
    const found = await this.db.execute<{
      id: string;
      latitude: string;
      longitude: string;
    }>(
      sql`SELECT id::text, latitude, longitude FROM cities
          WHERE slug = ${slug} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = found.rows[0];
    if (!row) throw notFound(ERROR.GEO_CITY_NOT_FOUND);
    return row;
  }

  private async cityById(id: string) {
    const found = await this.db.execute<{
      id: string;
      latitude: string;
      longitude: string;
    }>(
      sql`SELECT id::text, latitude, longitude FROM cities WHERE id = ${id}::uuid LIMIT 1`,
    );
    const row = found.rows[0];
    if (!row) throw notFound(ERROR.GEO_CITY_NOT_FOUND);
    return row;
  }

  private async kind(code: string) {
    const found = await this.db.execute<{ id: string }>(
      sql`SELECT id::text FROM landmark_kinds
          WHERE code = ${code} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = found.rows[0];
    if (!row) throw notFound(ERROR.LANDMARK_KIND_NOT_FOUND);
    return row;
  }

  /** The transposed-coordinate catch. See the class note. */
  private assertNearCity(
    city: { latitude: string | null; longitude: string | null },
    latitude: string,
    longitude: string,
  ): void {
    /* A city with no coordinates cannot anchor the check; nothing else can either. */
    if (!city.latitude || !city.longitude) return;

    const metres = distanceMetres(
      Number(city.latitude),
      Number(city.longitude),
      Number(latitude),
      Number(longitude),
    );

    if (metres > LANDMARK_MAX_KM_FROM_CITY * 1000) {
      throw badRequest(ERROR.LANDMARK_TOO_FAR_FROM_CITY);
    }
  }
}
