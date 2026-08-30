import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  type CreateCityCategoryInput,
  type UpdateCityCategoryInput,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { conflict, notFound } from '../common/errors/app-error.js';

export interface CityCategoryRow {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly nameDe: string;
  readonly isActive: boolean;
  readonly sortOrder: number;
  /** How many live cities are filed under it — what makes retiring one a visible decision. */
  readonly cities: number;
}

/**
 * الفئات — city categories, managed rather than deployed (Bashar, 2026-08-30).
 *
 * ## Why this exists
 *
 * `city_category` was a `pgEnum`, so adding «ريفية» or renaming «ساحلية» was a migration, a
 * deployment and a release. Every other reference set here is already a table for exactly that
 * reason — `amenities` says it outright: «Admin-managed so a new filter (§5.5) needs no deploy».
 *
 * ## Both sides are written
 *
 * `city_category_links` is the authority for what a city is filed under; `cities.categories`, the
 * `city_category[]` column, stays populated in step because the customer city page, the home
 * page's category strip, `catalog.service` and the geography screen all read it. A new category
 * has no enum member, so it can only be linked — the array is written for the four that predate
 * this and the join for everything. That asymmetry is temporary and recorded in FUTURE-WORK; it is
 * not a reason to leave the categories un-managed for another release.
 *
 * ## Nothing is deleted
 *
 * A category a city is filed under cannot be removed — the link would orphan, and the city page
 * would print a code where a word belongs. `isActive` takes it out of the pickers and leaves the
 * cities that already carry it intact.
 */
@Injectable()
export class GeoCategoryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<CityCategoryRow[]> {
    const result = await this.db.execute<{
      code: string;
      name_ar: string;
      name_en: string;
      name_de: string;
      is_active: boolean;
      sort_order: number;
      cities: number;
    }>(sql`
      SELECT cc.code, cc.name_ar, cc.name_en, cc.name_de, cc.is_active, cc.sort_order,
             coalesce(used.n, 0)::int AS cities
      FROM city_categories cc
      LEFT JOIN (
        SELECT l.category_id, count(*) AS n
        FROM city_category_links l
        JOIN cities c ON c.id = l.city_id AND c.deleted_at IS NULL
        GROUP BY l.category_id
      ) used ON used.category_id = cc.id
      WHERE cc.deleted_at IS NULL
      ORDER BY cc.sort_order, cc.code
    `);

    return result.rows.map((row) => ({
      code: row.code,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      nameDe: row.name_de,
      isActive: row.is_active,
      sortOrder: row.sort_order,
      cities: row.cities,
    }));
  }

  async create(
    actor: AccessTokenClaims | undefined,
    input: CreateCityCategoryInput,
  ): Promise<{ code: string }> {
    const clash = await this.db.execute<{ code: string }>(sql`
      SELECT code FROM city_categories WHERE code = ${input.code} LIMIT 1
    `);

    if (clash.rows[0]) throw conflict(ERROR.GEO_CODE_TAKEN);

    await this.db.transaction(async (tx) => {
      /*
        Appended, not inserted at a position. `sort_order` decides the order a reader sees, and a
        new category taking somebody else's number would silently reorder the strip on the customer
        home page — a change nobody asked for, made by adding something unrelated.
      */
      await tx.execute(sql`
        INSERT INTO city_categories (code, name_ar, name_en, name_de, sort_order)
        VALUES (${input.code}, ${input.nameAr}, ${input.nameEn}, ${input.nameDe},
                (SELECT coalesce(max(sort_order), 0) + 1 FROM city_categories))
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'city_category.created',
          subjectType: 'city_category',
          after: { code: input.code, nameAr: input.nameAr },
        },
        tx as unknown as Database,
      );
    });

    return { code: input.code };
  }

  async update(
    actor: AccessTokenClaims | undefined,
    code: string,
    input: UpdateCityCategoryInput,
  ): Promise<{ code: string }> {
    const before = await this.db.execute<{
      id: string;
      name_ar: string;
      is_active: boolean;
      cities: number;
    }>(sql`
      SELECT cc.id::text, cc.name_ar, cc.is_active,
             (SELECT count(*)::int FROM city_category_links l
              JOIN cities c ON c.id = l.city_id AND c.deleted_at IS NULL
              WHERE l.category_id = cc.id) AS cities
      FROM city_categories cc
      WHERE cc.code = ${code} AND cc.deleted_at IS NULL
      LIMIT 1
    `);

    const row = before.rows[0];

    if (!row) throw notFound(ERROR.GEO_CATEGORY_NOT_FOUND);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE city_categories SET
          name_ar    = coalesce(${input.nameAr ?? null}, name_ar),
          name_en    = coalesce(${input.nameEn ?? null}, name_en),
          name_de    = coalesce(${input.nameDe ?? null}, name_de),
          is_active  = coalesce(${input.isActive ?? null}, is_active),
          sort_order = coalesce(${input.sortOrder ?? null}, sort_order),
          updated_at = now()
        WHERE id = ${row.id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'city_category.updated',
          subjectType: 'city_category',
          before: { code, nameAr: row.name_ar, isActive: row.is_active },
          /*
            How many cities carry it. Retiring a category they are filed under is the decision with
            a consequence, and a flag alone cannot answer «what did that change» afterwards.
          */
          after: { code, ...input, cities: row.cities },
        },
        tx as unknown as Database,
      );
    });

    return { code };
  }
}
