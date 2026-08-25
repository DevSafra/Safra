import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  PERMISSIONS as P,
  propertyTypeActiveSchema,
  propertyTypeCreateSchema,
  type PropertyTypeActiveInput,
  type PropertyTypeCreateInput,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { RequirePermissions } from '../rbac/decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { conflict, notFound } from '../common/errors/app-error.js';

/**
 * §8.2 — «أنواع أخرى قابلة للإضافة من الإدارة».
 *
 * ## What was missing
 *
 * The seven types the SRS lists existed as rows and `property-types` was a single public `GET`.
 * Nothing anywhere wrote the table, so adding an eighth meant a migration and a deploy — which is
 * precisely what that sentence says must not be necessary.
 *
 * ## Deliberately three routes and no more
 *
 * List, add, retire. Renaming a type, reordering the list and choosing a glyph are edits to a row
 * that already exists, and nobody is blocked on any of them; §8.2 asks that a type can be ADDED
 * from the administration side. A catalogue editor is a different piece of work and should be
 * asked for rather than assumed.
 *
 * ## `SETTINGS_UPDATE`, not a new permission
 *
 * An accommodation type is platform configuration — it decides what a partner may register and
 * what a customer may filter by. Whoever may change the platform's settings may add one. A
 * dedicated permission would mean a new entry in the map, in every role seed and in the tests that
 * hold them, for a capability with the same audience.
 */
@Controller('admin/property-types')
export class PropertyTypesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Every type, retired ones included — this is the management view.
   *
   * The public `GET /property-types` returns only what is active, because that list is what a
   * partner may choose from. Staff need to see a retired type too, or "why can nobody pick
   * chalet any more" has no answer on the screen that caused it.
   */
  @Get()
  @RequirePermissions(P.SETTINGS_READ)
  async list() {
    const rows = await this.db.execute<{
      code: string;
      name_ar: string;
      name_en: string;
      name_de: string;
      has_multiple_units: boolean;
      is_active: boolean;
      in_use: number;
    }>(sql`
      SELECT t.code, t.name_ar, t.name_en, t.name_de,
             t.has_multiple_units, t.is_active,
             (SELECT count(*) FROM properties p
               WHERE p.property_type_id = t.id AND p.deleted_at IS NULL)::int AS in_use
      FROM property_types t
      ORDER BY t.sort_order, t.code
    `);

    return rows.rows.map((row) => ({
      code: row.code,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      nameDe: row.name_de,
      hasMultipleUnits: row.has_multiple_units,
      isActive: row.is_active,
      /* So a reader can see what retiring one would affect before they do it. */
      inUse: row.in_use,
    }));
  }

  /**
   * Adds a type.
   *
   * `sort_order` is the end of the list: the seven seeded types are ordered deliberately and a new
   * one has no claim on a position among them. `ON CONFLICT DO NOTHING` rather than catching a
   * unique violation, so a duplicate code is a clean 409 instead of a database error surfacing as
   * a 500.
   */
  @Post()
  @RequirePermissions(P.SETTINGS_UPDATE)
  async create(
    @Body(new ZodValidationPipe(propertyTypeCreateSchema)) body: PropertyTypeCreateInput,
  ) {
    const rows = await this.db.execute<{ code: string }>(sql`
      INSERT INTO property_types
        (code, name_ar, name_en, name_de, has_multiple_units, sort_order)
      VALUES (
        ${body.code}, ${body.nameAr}, ${body.nameEn}, ${body.nameDe},
        ${body.hasMultipleUnits},
        (SELECT coalesce(max(sort_order), 0) + 1 FROM property_types)
      )
      ON CONFLICT (code) DO NOTHING
      RETURNING code
    `);

    if (!rows.rows[0]) throw conflict(ERROR.PROPERTY_TYPE_CODE_TAKEN);

    return { code: body.code };
  }

  /**
   * Retires a type, or brings it back.
   *
   * Never a delete. `properties.property_type_id` is a foreign key, so removing a type in use is
   * refused by the database — and removing an UNUSED one would still erase the record of what the
   * platform once offered. `is_active` takes it off the list a partner chooses from and leaves
   * every existing listing exactly as it is.
   */
  @Patch(':code')
  @RequirePermissions(P.SETTINGS_UPDATE)
  async setActive(
    @Param('code') code: string,
    @Body(new ZodValidationPipe(propertyTypeActiveSchema)) body: PropertyTypeActiveInput,
  ) {
    const rows = await this.db.execute<{ code: string }>(sql`
      UPDATE property_types
      SET is_active = ${body.isActive}, updated_at = now()
      WHERE code = ${code}
      RETURNING code
    `);

    if (!rows.rows[0]) throw notFound(ERROR.PROPERTY_TYPE_NOT_FOUND);

    return { code, isActive: body.isActive };
  }
}
