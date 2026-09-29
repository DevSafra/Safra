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
import { ImageService } from '../storage/image.service.js';
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
  /** The cover photograph, or null. Never a key without its rendered widths — see the schema. */
  readonly cover: {
    readonly fileKey: string;
    readonly variantWidths: readonly number[];
    readonly width: number | null;
    readonly height: number | null;
    readonly alt: {
      readonly ar: string | null;
      readonly en: string | null;
      readonly de: string | null;
    };
  } | null;
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
  readonly cover_file_key: string | null;
  readonly cover_variant_widths: number[] | null;
  readonly cover_width: number | null;
  readonly cover_height: number | null;
  readonly cover_alt_ar: string | null;
  readonly cover_alt_en: string | null;
  readonly cover_alt_de: string | null;
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
    private readonly images: ImageService,
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
               g.seats, g.status::text AS status,
               g.cover_file_key, g.cover_variant_widths, g.cover_width, g.cover_height,
               g.cover_alt_ar, g.cover_alt_en, g.cover_alt_de
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

    /*
      A trip may not GO PUBLIC without a photograph (Bashar, 2026-09-29).
      «I do not want Group Trips displayed as text-only content.»

      The TRANSITION is what is guarded, not the state. Holding every published trip to this on
      every save would make the rows that predate the column uneditable — an operator fixing a typo
      on a trip announced last month would be told to upload a photograph first, which is a rule
      arriving as an obstruction rather than as a standard. Guarding the door instead means the
      requirement applies to everything announced from now on, and an older trip is brought up to it
      the next time somebody deliberately re-publishes it.

      This is the `submitForReview` half of the readiness philosophy, not the readiness-check half:
      `readiness.ts` says in its own opening that it is «not validation» and exists to SHOW gaps on
      things already live, while the moment a thing goes in front of a guest is where a standard is
      applied. A draft is still held to nothing.
    */
    const goingPublic = status === 'published' && before.status !== 'published';

    if (goingPublic && !before.cover) throw badRequest(ERROR.GROUP_TRIP_COVER_REQUIRED);

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
          /*
            Absent leaves it alone; an explicit null clears it. A nullish-coalesce against the
            previous value cannot say both — it would turn «clear this alt» into «keep the old
            one», which is the bug the optional() contract helper was fixed for on 2026-09-28.
            (No backticks in here: they would close the surrounding SQL template.)
          */
          cover_alt_ar   = ${input.coverAltAr === undefined ? sql`cover_alt_ar` : input.coverAltAr},
          cover_alt_en   = ${input.coverAltEn === undefined ? sql`cover_alt_en` : input.coverAltEn},
          cover_alt_de   = ${input.coverAltDe === undefined ? sql`cover_alt_de` : input.coverAltDe},
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
             g.seats, g.status::text AS status,
             g.cover_file_key, g.cover_variant_widths, g.cover_width, g.cover_height,
             g.cover_alt_ar, g.cover_alt_en, g.cover_alt_de
        FROM group_trips g
        JOIN cities c ON c.id = g.city_id
        LEFT JOIN currencies cur ON cur.id = g.currency_id
       WHERE g.slug = ${slug} AND g.deleted_at IS NULL
    `);

    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.GROUP_TRIP_NOT_FOUND);

    return toRow(row);
  }

  /**
   * The cover photograph (Bashar, 2026-09-29: «Add a cover image to every Group Trip»).
   *
   * ## The bytes and the words are different endpoints, deliberately
   *
   * This writes `cover_file_key`, the dimensions and the rendered widths — the worker's facts,
   * which no form may edit, because a form that can change them is a form that can make a row
   * describe an object that is not there. The ALT TEXT travels on `update` with the rest of the
   * trip's words, which is where a translator looks for it. `city-images.controller.ts` draws the
   * same line and gives the same reason.
   *
   * ## Replacing is an overwrite, and the old object is left behind
   *
   * Same as every other image in this system (P-003): the bytes stay in the store while only the
   * pointer moves. An `images.remove()` here would delete an object a soft-deleted row elsewhere
   * might still name, and storage is cheap next to a broken photograph.
   */
  async setCover(
    actor: AccessTokenClaims | undefined,
    slug: string,
    buffer: Buffer,
  ): Promise<GroupTripRow> {
    const found = await this.db.execute<{ slug: string }>(
      sql`SELECT slug FROM group_trips WHERE slug = ${slug} AND deleted_at IS NULL`,
    );
    const trip = found.rows[0];

    if (!trip) throw notFound(ERROR.GROUP_TRIP_NOT_FOUND);

    /*
      Decoded, resized, re-encoded, EXIF stripped — the same call the city hero makes.

      `owner` is the slug the DATABASE answered with, not the one the request carried. They are
      equal here by the WHERE clause above, so this changes no behaviour today; it is written this
      way because the value becomes a storage PATH, and «the path is built from a value the server
      resolved» is a property worth holding true by construction rather than by an argument about a
      predicate three lines up. `group-trips/*` is anonymously readable, which is what makes the
      distinction worth the word.
    */
    const processed = await this.images.process(buffer, {
      kind: 'group-trips',
      owner: trip.slug,
    });

    const widths = [...new Set(processed.variants.map((v) => v.width))];

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE group_trips SET
          cover_file_key = ${processed.fileKey},
          /*
            sql.param, because a bare JS array inside a template expands to a TUPLE — the
            interpolation becomes ($1, $2, $3) and Postgres answers «cannot cast type record to
            integer[]». One bound parameter, which node-postgres serialises as an array literal.
          */
          cover_variant_widths = ${sql.param(widths)}::integer[],
          cover_width = ${processed.width},
          cover_height = ${processed.height},
          updated_at = now()
        WHERE slug = ${slug} AND deleted_at IS NULL
      `);

      /*
        Through the service's own helper, which deliberately sends NO `subjectId`: a trip is
        identified by its slug and `audit_log.subject_id` is a uuid column, so naming it there is
        a 22P02 at write time. The slug travels in the payload, where سجل التدقيق reads it.
      */
      await this.record(tx, actor, 'group_trip.cover_uploaded', undefined, {
        slug,
        width: processed.width,
        height: processed.height,
      });
    });

    return this.bySlug(slug);
  }

  /**
   * Removes the cover, and every column that describes it in the same statement.
   *
   * Clearing the key alone would leave alt text and a width behind — which the CHECK constraint
   * refuses outright, so this is not a tidiness argument: a partial clear fails loudly. Writing
   * all seven columns is the only shape the table accepts, which is the point of the constraint.
   */
  async removeCover(
    actor: AccessTokenClaims | undefined,
    slug: string,
  ): Promise<GroupTripRow> {
    const found = await this.db.execute<{
      cover_file_key: string | null;
      status: string;
    }>(
      sql`SELECT cover_file_key, status::text AS status FROM group_trips
          WHERE slug = ${slug} AND deleted_at IS NULL`,
    );

    const row = found.rows[0];

    if (!row) throw notFound(ERROR.GROUP_TRIP_NOT_FOUND);
    if (row.cover_file_key === null) throw notFound(ERROR.IMAGE_NOT_FOUND);

    /*
      Both directions of the pair. Guarding only the publish transition would leave the back door
      open: announce a trip WITH a photograph, then delete it, and the result is the published
      text-only trip the rule exists to prevent — reached by two legal steps instead of one.

      Replacing a cover is unaffected: `setCover` overwrites and never passes through this path. So
      the rule reads «a published trip always has a photograph», which is the thing meant, rather
      than «a trip needs one at the instant it is published», which is the thing a single guard
      would have said.
    */
    if (row.status === 'published') throw badRequest(ERROR.GROUP_TRIP_COVER_REQUIRED);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE group_trips SET
          cover_file_key = NULL,
          cover_variant_widths = '{}',
          cover_width = NULL,
          cover_height = NULL,
          cover_alt_ar = NULL,
          cover_alt_en = NULL,
          cover_alt_de = NULL,
          updated_at = now()
        WHERE slug = ${slug} AND deleted_at IS NULL
      `);

      await this.record(tx, actor, 'group_trip.cover_removed', { slug }, undefined);
    });

    return this.bySlug(slug);
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
    cover:
      row.cover_file_key === null
        ? null
        : {
            fileKey: row.cover_file_key,
            variantWidths: row.cover_variant_widths ?? [],
            width: row.cover_width,
            height: row.cover_height,
            alt: { ar: row.cover_alt_ar, en: row.cover_alt_en, de: row.cover_alt_de },
          },
  };
}
