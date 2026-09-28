import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  COUNT_CAP,
  ERROR,
  type GroupTripCreateInput,
  type GroupTripUpdateInput,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';

export interface GroupTripRow {
  readonly slug: string;
  readonly titleAr: string;
  readonly titleEn: string | null;
  readonly titleDe: string | null;
  readonly summaryAr: string;
  readonly summaryEn: string | null;
  readonly summaryDe: string | null;
  readonly descriptionAr: string;
  readonly descriptionEn: string | null;
  readonly descriptionDe: string | null;
  readonly citySlug: string;
  readonly cityNameAr: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly priceFrom: string | null;
  readonly currencyCode: string | null;
  readonly seats: number | null;
  readonly status: string;
}

type TripSqlRow = {
  readonly slug: string;
  readonly title_ar: string;
  readonly title_en: string | null;
  readonly title_de: string | null;
  readonly summary_ar: string;
  readonly summary_en: string | null;
  readonly summary_de: string | null;
  readonly description_ar: string;
  readonly description_en: string | null;
  readonly description_de: string | null;
  readonly city_slug: string;
  readonly city_name_ar: string;
  readonly starts_on: string;
  readonly ends_on: string;
  readonly price_from: string | null;
  readonly currency_code: string | null;
  readonly seats: number | null;
  readonly status: string;
};

/**
 * جروبات — authoring the trips SAFRA announces (Bashar, 2026-09-27; built 2026-09-28).
 *
 * ## Why `CATALOGUE_MANAGE` and not a new permission
 *
 * The same question `faq.service.ts` answers, with the same answer: this is platform-wide content
 * authored by a super admin and read by everyone, and «only the admin can create a group trip» is
 * precisely who holds that permission. A second permission over the same actor and the same blast
 * radius would be a distinction nobody could act on.
 *
 * ## The slug is chosen once
 *
 * `update` cannot change it, the decision كتالوج المنصّة's `code` takes for the same reason: the
 * slug is what a public URL and every shared link key on, so renaming it looks like a rename and
 * behaves like a deletion to everybody holding the old one. A trip that needs a different address
 * is a new trip.
 *
 * ## Publishing is a status change, not a separate verb
 *
 * There is no `publish()` method. `status` moves through `update` like every other field, and
 * `published_at` is stamped the first time it reaches `published` — so «when was this announced»
 * stays answerable after somebody archives and re-publishes it.
 */
@Injectable()
export class GroupTripsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** The console registry: every trip, newest first, paged. */
  async list(query: { readonly limit: number; readonly page: number }) {
    /* One fragment for the list and the count, so the total cannot drift from the rows. */
    const fromWhere = sql`FROM group_trips g
      JOIN cities c ON c.id = g.city_id
      LEFT JOIN currencies cur ON cur.id = g.currency_id
      WHERE g.deleted_at IS NULL`;

    const [rows, total] = await Promise.all([
      this.db.execute<TripSqlRow>(sql`
        SELECT g.slug, g.title_ar, g.title_en, g.title_de,
               g.summary_ar, g.summary_en, g.summary_de,
               g.description_ar, g.description_en, g.description_de,
               c.slug AS city_slug, c.name_ar AS city_name_ar,
               g.starts_on::text, g.ends_on::text,
               g.price_from::text, cur.code AS currency_code,
               g.seats, g.status::text AS status
        ${fromWhere}
        ORDER BY g.starts_on DESC, g.created_at DESC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
      `),
      this.countOf(fromWhere),
    ]);

    return {
      items: rows.rows.map(toRow),
      total: Math.min(total, COUNT_CAP),
      capped: total > COUNT_CAP,
    };
  }

  async create(
    actor: AccessTokenClaims | undefined,
    input: GroupTripCreateInput,
  ): Promise<{ slug: string }> {
    const cityId = await this.cityId(input.citySlug);
    const currencyId = await this.currencyId(input.currencyCode);

    if (await this.slugTaken(input.slug)) throw conflict(ERROR.GROUP_TRIP_SLUG_TAKEN);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO group_trips
          (slug, city_id, title_ar, title_en, title_de, summary_ar, summary_en, summary_de,
           description_ar, description_en, description_de, starts_on, ends_on,
           price_from, currency_id, seats)
        VALUES (${input.slug}, ${cityId}, ${input.titleAr}, ${input.titleEn ?? null},
                ${input.titleDe ?? null}, ${input.summaryAr}, ${input.summaryEn ?? null},
                ${input.summaryDe ?? null}, ${input.descriptionAr},
                ${input.descriptionEn ?? null}, ${input.descriptionDe ?? null},
                ${input.startsOn}, ${input.endsOn}, ${input.priceFrom ?? null},
                ${currencyId}, ${input.seats ?? null})
      `);

      await this.record(tx, actor, 'group_trip.created', undefined, {
        slug: input.slug,
        titleAr: input.titleAr,
        startsOn: input.startsOn,
      });
    });

    return { slug: input.slug };
  }

  async update(
    actor: AccessTokenClaims | undefined,
    slug: string,
    input: GroupTripUpdateInput,
  ): Promise<{ slug: string }> {
    const before = await this.bySlug(slug);

    const startsOn = input.startsOn ?? before.startsOn;
    const endsOn = input.endsOn ?? before.endsOn;

    /*
      Checked against the MERGED pair, not the submitted one. The schema can only compare what a
      request carries, so moving `startsOn` past an untouched `endsOn` passes it and would meet the
      database's CHECK as a 500 — which is the shape the contract's own note says to avoid.
    */
    if (endsOn < startsOn) throw badRequest(ERROR.GROUP_TRIP_DATES_ORDER);

    const priceFrom = input.priceFrom === undefined ? before.priceFrom : input.priceFrom;
    const currencyCode =
      input.currencyCode === undefined ? before.currencyCode : input.currencyCode;

    /* The same merge argument, for the pair the money rule cares about. */
    if ((priceFrom === null) !== (currencyCode === null)) {
      throw badRequest(ERROR.GROUP_TRIP_PRICE_NEEDS_CURRENCY);
    }

    const cityId = input.citySlug ? await this.cityId(input.citySlug) : null;
    const currencyId = await this.currencyId(currencyCode);
    const status = input.status ?? before.status;

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE group_trips SET
          city_id        = ${cityId ?? sql`city_id`},
          title_ar       = ${input.titleAr ?? before.titleAr},
          title_en       = ${input.titleEn === undefined ? before.titleEn : input.titleEn},
          title_de       = ${input.titleDe === undefined ? before.titleDe : input.titleDe},
          summary_ar     = ${input.summaryAr ?? before.summaryAr},
          summary_en     = ${input.summaryEn === undefined ? before.summaryEn : input.summaryEn},
          summary_de     = ${input.summaryDe === undefined ? before.summaryDe : input.summaryDe},
          description_ar = ${input.descriptionAr ?? before.descriptionAr},
          description_en = ${input.descriptionEn === undefined ? before.descriptionEn : input.descriptionEn},
          description_de = ${input.descriptionDe === undefined ? before.descriptionDe : input.descriptionDe},
          starts_on      = ${startsOn},
          ends_on        = ${endsOn},
          price_from     = ${priceFrom},
          currency_id    = ${currencyId},
          seats          = ${input.seats === undefined ? before.seats : (input.seats ?? null)},
          status         = ${status}::group_trip_status,
          /* Stamped the FIRST time it goes public, so «when was this announced» survives an archive. */
          published_at   = CASE WHEN ${status} = 'published' AND published_at IS NULL
                                THEN now() ELSE published_at END,
          updated_at     = now()
        WHERE slug = ${slug} AND deleted_at IS NULL
      `);

      await this.record(
        tx,
        actor,
        'group_trip.updated',
        { slug, titleAr: before.titleAr, status: before.status },
        { slug, titleAr: input.titleAr ?? before.titleAr, status },
      );
    });

    return { slug };
  }

  /**
   * Removed, and only while it was never public.
   *
   * A published trip is something people were told about; deleting the row would leave a shared
   * link answering 404 with no explanation. `archived` is the answer for those — it is a status a
   * reader can be shown, and P-003 keeps the row either way.
   */
  async remove(
    actor: AccessTokenClaims | undefined,
    slug: string,
  ): Promise<{ slug: string }> {
    const before = await this.bySlug(slug);

    if (before.status !== 'draft') throw conflict(ERROR.CATALOGUE_IN_USE, { count: 1 });

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE group_trips SET deleted_at = now(), updated_at = now()
         WHERE slug = ${slug} AND deleted_at IS NULL
      `);

      await this.record(tx, actor, 'group_trip.deleted', {
        slug,
        titleAr: before.titleAr,
      });
    });

    return { slug };
  }

  async bySlug(slug: string): Promise<GroupTripRow> {
    const rows = await this.db.execute<TripSqlRow>(sql`
      SELECT g.slug, g.title_ar, g.title_en, g.title_de,
             g.summary_ar, g.summary_en, g.summary_de,
             g.description_ar, g.description_en, g.description_de,
             c.slug AS city_slug, c.name_ar AS city_name_ar,
             g.starts_on::text, g.ends_on::text,
             g.price_from::text, cur.code AS currency_code,
             g.seats, g.status::text AS status
        FROM group_trips g
        JOIN cities c ON c.id = g.city_id
        LEFT JOIN currencies cur ON cur.id = g.currency_id
       WHERE g.slug = ${slug} AND g.deleted_at IS NULL
    `);

    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.GROUP_TRIP_NOT_FOUND);

    return toRow(row);
  }

  /* ── Internals ────────────────────────────────────────────────────────── */

  private async countOf(fromWhere: SQL): Promise<number> {
    /* Capped, so the database stops reading — an uncapped count is unbounded work per page view. */
    const result = await this.db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM (SELECT 1 ${fromWhere} LIMIT ${COUNT_CAP + 1}) capped`,
    );

    return Number(result.rows[0]?.n ?? 0);
  }

  private async slugTaken(slug: string): Promise<boolean> {
    const rows = await this.db.execute<{ one: number }>(
      sql`SELECT 1 AS one FROM group_trips WHERE slug = ${slug} AND deleted_at IS NULL`,
    );

    return rows.rows.length > 0;
  }

  private async cityId(slug: string): Promise<string> {
    const rows = await this.db.execute<{ id: string }>(
      sql`SELECT id FROM cities WHERE slug = ${slug} AND deleted_at IS NULL`,
    );

    const id = rows.rows[0]?.id;

    if (!id) throw badRequest(ERROR.GEO_CITY_UNKNOWN);

    return id;
  }

  private async currencyId(code: string | null | undefined): Promise<string | null> {
    if (!code) return null;

    const rows = await this.db.execute<{ id: string }>(
      sql`SELECT id FROM currencies WHERE code = ${code} AND deleted_at IS NULL`,
    );

    const id = rows.rows[0]?.id;

    if (!id) throw badRequest(ERROR.GEO_CURRENCY_UNKNOWN);

    return id;
  }

  private async record(
    tx: unknown,
    actor: AccessTokenClaims | undefined,
    action: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(
      {
        actorUserId: actor?.sub,
        actorRole: actor?.role,
        action,
        subjectType: 'group_trip',
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
      },
      tx as Database,
    );
  }
}

function toRow(row: TripSqlRow): GroupTripRow {
  return {
    slug: row.slug,
    titleAr: row.title_ar,
    titleEn: row.title_en,
    titleDe: row.title_de,
    summaryAr: row.summary_ar,
    summaryEn: row.summary_en,
    summaryDe: row.summary_de,
    descriptionAr: row.description_ar,
    descriptionEn: row.description_en,
    descriptionDe: row.description_de,
    citySlug: row.city_slug,
    cityNameAr: row.city_name_ar,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    priceFrom: row.price_from,
    currencyCode: row.currency_code,
    seats: row.seats === null ? null : Number(row.seats),
    status: row.status,
  };
}
