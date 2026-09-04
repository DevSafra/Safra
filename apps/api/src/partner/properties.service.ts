import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import {
  ERROR,
  PERMISSIONS as P,
  usesStarRating,
  type PropertyCreateInput,
  type PropertyUpdateInput,
  type UnitCreateInput,
  type UnitUpdateInput,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { imageIsPublished } from '../storage/image-visibility.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { assertMayPrice } from './price-authority.js';
import { requirePartnerId } from '../rbac/ownership.js';
import { badRequest, conflict, forbidden, notFound } from '../common/errors/app-error.js';
import { isVerifiedPartner } from '../rbac/verified-partner.guard.js';

/**
 * A partner may edit a listing only while it is theirs AND still editable.
 *
 * Once published, changing the address or city would invalidate the verification
 * SAFRA performed (§8.1), so structural edits are confined to pre-publication
 * states. Prices and calendar remain editable at any time — those are the
 * partner's ongoing responsibility (P-006).
 */
const STRUCTURALLY_EDITABLE = ['draft', 'pending_review', 'rejected'] as const;

@Injectable()
export class PropertiesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * The signed-in partner's own profile — the name the dashboard is headed with.
   *
   * The handoff's §7 sidebar shows the partner's business name («فندق قصر الشرق»), not an email
   * address. Scoped to the token's `partnerId`, so it can only ever return the caller's own row.
   */
  async profile(claims: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(claims, P.PROPERTY_MANAGE_OWN);

    const rows = await this.db.execute<{
      reference: string;
      display_name: string;
      legal_name: string;
      verification: string;
      score: number;
      tier: string;
      city_name_ar: string | null;
      property_count: number;
      review_average: string | null;
      suspended_since: string | null;
      suspended_reason: string | null;
    }>(sql`
      SELECT pa.reference, pa.display_name, pa.legal_name,
             pa.verification::text AS verification, pa.score, pa.tier::text AS tier,
             ci.name_ar AS city_name_ar,
             -- The §7 sidebar badges. Two correlated subqueries rather than two more round
             -- trips: every page in the portal reads this profile, so the badges ride along
             -- with it instead of each screen fetching its own counts.
             (SELECT count(*)::int FROM properties pr
              WHERE pr.partner_id = pa.id AND pr.deleted_at IS NULL) AS property_count,
             -- Over PUBLISHED reviews only, matching the number the public sees and the one
             -- the ranking uses. A badge disagreeing with the reviews screen is worse than none.
             (SELECT round(avg(rv.rating)::numeric, 1)::text FROM reviews rv
              WHERE rv.partner_id = pa.id AND rv.status = 'published') AS review_average
             ,
             -- The HOLD on this account, which this SELECT did not carry (Bashar, 2026-08-24).
             --
             -- Every page of the portal reads this profile, and the Shell renders the suspension
             -- notice from it -- so without these two columns the notice could never appear, on any
             -- screen, for any suspended partner. المحفظة's «التحويلات موقوفة» line is computed from
             -- the same field and was equally unreachable.
             --
             -- Nothing failed and nothing logged: the portal's schema carried a default of null on
             -- the suspension object, so a field the API never sent parsed cleanly as "not
             -- suspended". The whole partner-facing half of the suspension policy was inert, and it
             -- read as built.
             --
             -- suspended_notes is NOT selected. It is the one field in the suspension with a
             -- different audience -- staff-only, by the same rule that keeps score and tier from
             -- employees -- and this profile reaches whoever is signed in.
             to_char(pa.suspended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS suspended_since,
             pa.suspended_reason
      FROM partners pa
      LEFT JOIN cities ci ON ci.id = pa.city_id
      WHERE pa.id = ${partnerId} AND pa.deleted_at IS NULL
    `);

    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.PARTNER_NOT_FOUND);

    return {
      reference: row.reference,
      displayName: row.display_name,
      legalName: row.legal_name,
      verification: row.verification,
      /*
        SAFRA's internal rating of the business, withheld from EMPLOYEES (2026-08-23).

        This profile is read on every page of the portal, so whatever it carries reaches whoever is
        signed in — and since employees exist, that is no longer only the owner. Nothing renders
        either field today, which is exactly why it was easy to miss.

        `PARTNER_EMPLOYEE_PERMISSIONS` deliberately withholds `PAYOUT_READ_OWN` on the reasoning
        that a receptionist should not learn what the business earns. A score and a tier are the
        same category of fact about the business rather than about the work, so they follow the
        same rule. The owner still sees their own.
      */
      score: claims?.role === 'partner' ? row.score : null,
      tier: claims?.role === 'partner' ? row.tier : null,
      propertyCount: row.property_count,
      /** Null when the partner has no published reviews — the badge is then absent, not «0». */
      reviewAverage: row.review_average,
      city: row.city_name_ar,
      /*
        An OBJECT or null, not two loose fields.

        `Shell` and المحفظة both ask one question — "is this account on hold, and what does it say" —
        and a shape that can be half-present invites a screen to render «السبب:» with nothing after
        it. Built from `suspended_at`, so the reason cannot arrive without the date that explains it.
      */
      suspension:
        row.suspended_since === null
          ? null
          : { reason: row.suspended_reason ?? '', since: row.suspended_since },
    };
  }

  /**
   * Every listing this partner owns, with what the design handoff's §7.2 card actually draws.
   *
   * ## Why one query and not five
   *
   * The card needs a cover image, the trip-trait chips, a nightly price and a unit count. Fetching
   * those per listing is the N+1 the scale rules forbid, and a partner with thirty listings would
   * pay for it on every page view. The price and the count come from a lateral aggregate over
   * `units`, and the cover from a lateral pick of the first image — both indexed by `property_id`.
   *
   * ## The price is the CHEAPEST unit, and says so
   *
   * The handoff's card shows one figure with "/ ليلة". A property with a $45 single and a $140
   * suite has no single nightly price, so this returns the minimum — the "from" price the public
   * search also advertises. Returning an average would be a number that matches nothing bookable.
   *
   * Scoped to `partnerId` from the VERIFIED token, so this cannot return another partner's
   * listing regardless of what the caller asks for.
   */
  /**
   * ONE listing, with everything the تعديل form and the التقويم screen need.
   *
   * ## Why this exists rather than reusing `listOwn`
   *
   * The card list returns what a card draws — a name, a status, a price, a cover. An edit form has
   * to PREFILL, which means it needs the fields nobody looks at on a card: the address, the
   * coordinates, the descriptions in three languages, the city and policy CODES rather than their
   * Arabic names. A form prefilled from a list that does not carry them silently blanks whatever
   * it could not read, and a partner who saves it has just erased their own description.
   *
   * ## `isStructurallyEditable` is computed HERE
   *
   * The rule — draft, pending_review and rejected only — lives next to the `update` that enforces
   * it, so the screen and the endpoint cannot disagree about whether a form should be shown. A UI
   * that decided this for itself would eventually offer a form whose submit is refused, which is
   * the worst of both: the work is done and then discarded.
   *
   * The reason is §8.1: SAFRA verified the address, the photographs and the documents against each
   * other. Letting a published listing change its address would invalidate that verification while
   * leaving the «موثّق» badge in place, which is exactly the claim P-002 exists to protect.
   *
   * Prices, calendar and photographs stay editable at every status — those are the partner's
   * ongoing responsibility (P-006), and the screen says so rather than leaving the reader to
   * wonder what they are allowed to touch.
   */
  async readOwn(claims: AccessTokenClaims | undefined, reference: string) {
    const partnerId = requirePartnerId(claims, P.PROPERTY_MANAGE_OWN);

    const rows = await this.db.execute<{
      id: string;
      reference: string;
      slug: string;
      status: string;
      name_ar: string;
      name_en: string | null;
      name_de: string | null;
      description_ar: string | null;
      description_en: string | null;
      description_de: string | null;
      address: string;
      room_number: string | null;
      star_rating: number | null;
      latitude: string | null;
      longitude: string | null;
      attributes: string[] | null;
      city_slug: string;
      city_name_ar: string;
      property_type_code: string;
      cancellation_policy_code: string;
      review_notes: string | null;
    }>(sql`
      SELECT pr.id, pr.reference, pr.slug, pr.status::text AS status,
             pr.name_ar, pr.name_en, pr.name_de,
             pr.description_ar, pr.description_en, pr.description_de,
             pr.address, pr.room_number, pr.star_rating, pr.latitude, pr.longitude,
             pr.attributes,
             ci.slug AS city_slug, ci.name_ar AS city_name_ar,
             pt.code AS property_type_code,
             cp.code AS cancellation_policy_code,
             pr.review_notes
      FROM properties pr
      JOIN cities ci               ON ci.id = pr.city_id
      JOIN property_types pt       ON pt.id = pr.property_type_id
      JOIN cancellation_policies cp ON cp.id = pr.cancellation_policy_id
      WHERE pr.partner_id = ${partnerId}
        AND pr.reference = ${reference}
        AND pr.deleted_at IS NULL
      LIMIT 1
    `);

    const row = rows.rows[0];

    /* 404 rather than 403 for another partner's reference, so it cannot be probed for existence. */
    if (!row) throw notFound(ERROR.PROPERTY_NOT_FOUND);

    const units = await this.db.execute<{
      id: string;
      name_ar: string;
      unit_label: string | null;
      max_guests: number;
      bedrooms: number;
      beds: number;
      bathrooms: number;
      base_price: string;
      currency_code: string;
      min_nights: number;
      max_nights: number | null;
      is_active: boolean;
    }>(sql`
      SELECT un.id, un.name_ar, un.unit_label, un.max_guests, un.bedrooms, un.beds,
             un.bathrooms, un.base_price::text, cur.code AS currency_code,
             un.min_nights, un.max_nights, un.is_active
      FROM units un
      JOIN currencies cur ON cur.id = un.currency_id
      /*
        The id VERIFIED above, not a second lookup by reference. The reference is unique so both
        resolve alike today; reusing the checked id means the ownership test and the rows returned
        cannot come apart if that ever stops being true.
      */
      WHERE un.property_id = ${row.id}
        AND un.deleted_at IS NULL
      ORDER BY un.created_at
    `);

    return {
      reference: row.reference,
      slug: row.slug,
      status: row.status,
      name: { ar: row.name_ar, en: row.name_en, de: row.name_de },
      description: {
        ar: row.description_ar,
        en: row.description_en,
        de: row.description_de,
      },
      address: row.address,
      roomNumber: row.room_number,
      starRating: row.star_rating,
      latitude: row.latitude,
      longitude: row.longitude,
      attributes: row.attributes ?? [],
      citySlug: row.city_slug,
      cityNameAr: row.city_name_ar,
      propertyTypeCode: row.property_type_code,
      cancellationPolicyCode: row.cancellation_policy_code,
      /* Why a rejected listing was rejected — the one thing that makes the form worth reopening. */
      reviewNotes: row.status === 'rejected' ? row.review_notes : null,
      isStructurallyEditable: STRUCTURALLY_EDITABLE.includes(
        row.status as (typeof STRUCTURALLY_EDITABLE)[number],
      ),
      units: units.rows.map((unit) => ({
        id: unit.id,
        nameAr: unit.name_ar,
        unitLabel: unit.unit_label,
        maxGuests: unit.max_guests,
        bedrooms: unit.bedrooms,
        beds: unit.beds,
        bathrooms: unit.bathrooms,
        basePrice: unit.base_price,
        currencyCode: unit.currency_code,
        minNights: unit.min_nights,
        maxNights: unit.max_nights,
        isActive: unit.is_active,
      })),
    };
  }

  async listOwn(claims: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(claims, P.PROPERTY_MANAGE_OWN);

    const rows = await this.db.execute<{
      reference: string;
      slug: string;
      name_ar: string;
      name_en: string | null;
      room_number: string | null;
      star_rating: number | null;
      status: string;
      rating: string | null;
      reviews_count: number;
      attributes: string[] | null;
      badges: string[] | null;
      city_name_ar: string | null;
      city_categories: string[] | null;
      property_type: string | null;
      cover_key: string | null;
      cover_widths: number[] | null;
      unit_count: number;
      from_price: string | null;
      currency_code: string | null;
      created_at: string;
    }>(sql`
      SELECT pr.reference, pr.slug, pr.name_ar, pr.name_en, pr.room_number, pr.star_rating,
             pr.status::text AS status,
             pr.rating::text AS rating, pr.reviews_count, pr.attributes, pr.badges,
             ci.name_ar AS city_name_ar,
             -- The CITY's categories, in the partner's language — «ساحلية · تاريخية».
             -- Read from city_category_links, the authority, so a category staff add on الفئات
             -- reaches this dashboard the same day it reaches the public site (Bashar,
             -- 2026-08-30). Retired ones are excluded: a partner reading what kind of
             -- destination they are listing in should see what SAFRA currently says, not what
             -- it used to. A NAME, not a code, for the same reason city is ci.name_ar here.
             coalesce((
               SELECT array_agg(cc.name_ar ORDER BY cc.sort_order, cc.code)
               FROM city_category_links l
               JOIN city_categories cc ON cc.id = l.category_id
               WHERE l.city_id = ci.id AND cc.is_active AND cc.deleted_at IS NULL
             ), '{}') AS city_categories,
             pt.code    AS property_type,
             img.file_key AS cover_key,
             img.variant_widths AS cover_widths,
             coalesce(u.unit_count, 0)::int AS unit_count,
             u.from_price::text AS from_price,
             u.currency_code,
             to_char(pr.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
      FROM properties pr
      JOIN cities ci        ON ci.id = pr.city_id
      JOIN property_types pt ON pt.id = pr.property_type_id
      LEFT JOIN LATERAL (
        SELECT pi.file_key, pi.variant_widths FROM property_images pi
        WHERE pi.property_id = pr.id AND ${imageIsPublished('pi')}
        ORDER BY pi.is_cover DESC, pi.sort_order ASC
        LIMIT 1
      ) img ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS unit_count,
               min(un.base_price) AS from_price,
               min(cur.code)      AS currency_code
        FROM units un
        JOIN currencies cur ON cur.id = un.currency_id
        WHERE un.property_id = pr.id AND un.deleted_at IS NULL
      ) u ON true
      WHERE pr.partner_id = ${partnerId} AND pr.deleted_at IS NULL
      ORDER BY pr.created_at DESC
    `);

    return rows.rows.map((row) => ({
      reference: row.reference,
      slug: row.slug,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      roomNumber: row.room_number,
      starRating: row.star_rating,
      status: row.status,
      rating: row.rating,
      reviewsCount: row.reviews_count,
      /* Always an array, so the card never has to guard before mapping. */
      attributes: row.attributes ?? [],
      badges: row.badges ?? [],
      city: row.city_name_ar,
      /* Always an array, so the card never has to guard before mapping. */
      cityCategories: row.city_categories ?? [],
      propertyType: row.property_type,
      /*
        The KEY and its rendered widths, not a URL. The media base differs per environment and the
        pipeline never upscales, so only the caller knows which variant to ask for — the customer
        site's `imageUrl()` has encoded that rule since the gallery shipped, and a second rule here
        would be a second thing to keep in step.
      */
      coverKey: row.cover_key,
      coverWidths: row.cover_widths ?? [],
      unitCount: row.unit_count,
      fromPrice: row.from_price,
      currencyCode: row.currency_code,
      createdAt: row.created_at,
    }));
  }

  async create(claims: AccessTokenClaims | undefined, input: PropertyCreateInput) {
    const partnerId = requirePartnerId(claims, P.PROPERTY_MANAGE_OWN);

    /*
      `initialUnits` is a PRICE, so it is behind verification — and this route is not.

      Step 7 puts units, prices, dates and images behind verification, and every DEDICATED route
      for them carries `@RequireVerifiedPartner()`. This one deliberately does not: writing a
      listing's address and description before verification is what makes the wait useful, and
      «حسابك قيد المراجعة» promises exactly that. Then `initialUnits` was added to the create form
      — «عدد الوحدات» and «السعر لليلة» on the same screen — and it writes units carrying a
      `basePrice`, on the one property route the guard cannot cover.

      So an unverified partner could do through the add-property form precisely what
      `POST properties/:reference/units` refuses them, and the portal told them they could not.
      Found by Bashar on 2026-08-21, walking the joining journey on his own account: a partner with
      no documents uploaded had a unit priced at $250 a night. Reproduced against a `pending`
      fixture — three units, 201.

      A guard is all-or-nothing and cannot refuse ONE FIELD of a permitted request, which is why
      this is here and not a decorator. `isVerifiedPartner` is the guard's own definition, imported
      rather than restated.
    */
    if (input.initialUnits && !(await isVerifiedPartner(this.db, partnerId))) {
      throw forbidden(ERROR.PARTNER_NOT_VERIFIED);
    }

    /*
      And by the same sentence — `initialUnits` IS a price — it is behind `price.update`.

      The verification check above and this one refuse the same field for two different reasons: one
      asks whether the BUSINESS may price yet, the other whether this PERSON may. An employee with
      `property.manage_own` and no pricing grant can write the listing and must leave «السعر لليلة»
      to somebody who holds it. The field is what is refused, not the route: the listing itself
      still gets created.
    */
    assertMayPrice(claims, input.initialUnits !== undefined);

    const [city, type, policy] = await Promise.all([
      this.db.query.cities.findFirst({
        where: and(
          eq(schema.cities.slug, input.citySlug),
          isNull(schema.cities.deletedAt),
        ),
        columns: { id: true },
      }),
      this.db.query.propertyTypes.findFirst({
        where: eq(schema.propertyTypes.code, input.propertyTypeCode),
        columns: { id: true },
      }),
      this.db.query.cancellationPolicies.findFirst({
        where: eq(schema.cancellationPolicies.code, input.cancellationPolicyCode),
        columns: { id: true },
      }),
    ]);

    if (!city) throw badRequest(ERROR.GEO_CITY_UNKNOWN);
    if (!type) throw badRequest(ERROR.PROPERTY_TYPE_UNKNOWN);
    if (!policy) {
      // §7.4: partners pick from SAFRA-approved policies; they cannot invent terms.
      throw badRequest(ERROR.PROPERTY_CANCELLATION_POLICY_UNKNOWN);
    }

    const slug = await this.uniqueSlug(input.name.ar, input.name.en);

    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.properties)
        .values({
          partnerId,
          cityId: city.id,
          propertyTypeId: type.id,
          cancellationPolicyId: policy.id,
          slug,
          nameAr: input.name.ar,
          nameEn: input.name.en ?? input.name.ar,
          nameDe: input.name.de ?? input.name.ar,
          descriptionAr: input.description?.ar ?? null,
          descriptionEn: input.description?.en ?? null,
          descriptionDe: input.description?.de ?? null,
          address: input.address,
          /* Empty means none: the field is optional, and `''` would be a room called nothing. */
          roomNumber: input.roomNumber?.trim() || null,
          /*
            A hotel's classification, and NOTHING for anything else (Bashar, 2026-09-04).

            `propertyCreateSchema` already refuses a villa that sends one, so this is not the
            check — it is the guarantee that survives a caller the schema has not met. `?? null`
            rather than leaving the key out, because an explicit null says «this listing has no
            classification» where an absent key would inherit whatever a default decided.
          */
          starRating: usesStarRating(input.propertyTypeCode)
            ? (input.starRating ?? null)
            : null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          attributes: input.attributes,
          // Forced. Never taken from input — the schema has no status field, and
          // this is the second barrier (§8.1 / P-002).
          status: 'draft',
        })
        .returning({ reference: schema.properties.reference, id: schema.properties.id });

      if (!row) throw new Error('Property insert returned no row.');

      /*
        The units the partner asked for, in the SAME transaction.

        A listing with no unit cannot be booked and cannot be priced, so creating one and leaving
        it empty would produce a listing that looks finished and is not. In one transaction because
        a property that exists without its units is exactly that half-state.

        The currency is the city's country default rather than anything in the request: a partner
        does not choose what currency SAFRA prices in.
      */
      if (input.initialUnits) {
        const currency = await tx.execute<{ id: string }>(
          sql`SELECT id FROM currencies WHERE code = 'USD' LIMIT 1`,
        );
        const currencyId = currency.rows[0]?.id;

        if (!currencyId) throw new Error('No USD currency row to price units in.');

        for (let index = 1; index <= input.initialUnits.count; index += 1) {
          const suffix = input.initialUnits.count > 1 ? ` ${index}` : '';

          await tx.insert(schema.units).values({
            propertyId: row.id,
            nameAr: `${input.name.ar}${suffix}`,
            nameEn: `${input.name.en ?? input.name.ar}${suffix}`,
            nameDe: `${input.name.de ?? input.name.ar}${suffix}`,
            maxGuests: input.initialUnits.maxGuests,
            basePrice: input.initialUnits.basePrice.toFixed(2),
            currencyId,
            /*
              Every unit starts numbered, so التقويمات can name a room rather than repeat one name
              per row (Bashar, 2026-08-19). The index is a STARTING POINT, not a claim: a partner
              whose rooms are 204 and 205 edits them, which is why the field is on the unit editor.
              Without a default, «رقم الوحدة» would be blank on every unit until somebody typed one,
              which is what made this look unimplemented.
            */
            unitLabel: String(index),
          });
        }
      }

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'property.created',
          subjectType: 'property',
          subjectId: row.id,
          after: { reference: row.reference, slug, status: 'draft' },
        },
        tx as unknown as Database,
      );

      return row;
    });

    return { reference: created.reference, slug, status: 'draft' as const };
  }

  async update(
    claims: AccessTokenClaims | undefined,
    reference: string,
    input: PropertyUpdateInput,
  ) {
    const partnerId = requirePartnerId(claims, P.PROPERTY_MANAGE_OWN);
    const property = await this.findOwned(partnerId, reference);

    if (
      !STRUCTURALLY_EDITABLE.includes(
        property.status as (typeof STRUCTURALLY_EDITABLE)[number],
      )
    ) {
      throw conflict(ERROR.PROPERTY_NOT_STRUCTURALLY_EDITABLE);
    }

    const patch: Record<string, unknown> = {};

    if (input.name) {
      patch['nameAr'] = input.name.ar;
      if (input.name.en) patch['nameEn'] = input.name.en;
      if (input.name.de) patch['nameDe'] = input.name.de;
    }
    if (input.description) {
      if (input.description.ar) patch['descriptionAr'] = input.description.ar;
      if (input.description.en) patch['descriptionEn'] = input.description.en;
      if (input.description.de) patch['descriptionDe'] = input.description.de;
    }
    if (input.address !== undefined) patch['address'] = input.address;
    /*
      An empty string CLEARS it, which is how a partner removes a room number typed by mistake —
      `|| null` rather than `?? null`, so `''` becomes null instead of a room called nothing.
    */
    if (input.roomNumber !== undefined)
      patch['roomNumber'] = input.roomNumber.trim() || null;
    /*
      The star classification, judged against the listing's STORED type.

      `propertyUpdateSchema` can only decide the case where a patch names the type AND the rating
      together; a patch naming just the rating depends on what this listing already is, which no
      schema can see. So the second half is here — and it refuses rather than silently dropping,
      for the same reason the schema does: a partner who is quietly ignored believes they declared
      something they did not.

      No clearing: unlike a room number there is no "none" to go back to. A hotel either declares a
      classification or keeps the one it declared, and an empty submission arrives as `undefined`
      and is simply not patched.
    */
    if (input.starRating !== undefined) {
      if (!usesStarRating(property.propertyType.code)) {
        throw badRequest(ERROR.VALIDATION_STAR_RATING_NOT_A_HOTEL);
      }

      patch['starRating'] = input.starRating;
    }
    if (input.attributes !== undefined) patch['attributes'] = input.attributes;
    if (input.latitude !== undefined) patch['latitude'] = input.latitude;
    if (input.longitude !== undefined) patch['longitude'] = input.longitude;

    if (input.citySlug) {
      const city = await this.db.query.cities.findFirst({
        where: and(
          eq(schema.cities.slug, input.citySlug),
          isNull(schema.cities.deletedAt),
        ),
        columns: { id: true },
      });
      if (!city) throw badRequest(ERROR.GEO_CITY_UNKNOWN);
      patch['cityId'] = city.id;
    }

    if (input.cancellationPolicyCode) {
      const policy = await this.db.query.cancellationPolicies.findFirst({
        where: eq(schema.cancellationPolicies.code, input.cancellationPolicyCode),
        columns: { id: true },
      });
      if (!policy) {
        throw badRequest(ERROR.PROPERTY_CANCELLATION_POLICY_UNKNOWN);
      }
      patch['cancellationPolicyId'] = policy.id;
    }

    if (Object.keys(patch).length === 0) {
      throw badRequest(ERROR.SETTING_NO_UPDATABLE_FIELDS);
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.properties)
        .set(patch)
        .where(eq(schema.properties.id, property.id));

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'property.updated',
          subjectType: 'property',
          subjectId: property.id,
          after: patch,
        },
        tx as unknown as Database,
      );
    });

    return { reference, updated: Object.keys(patch) };
  }

  /**
   * Partner submits a draft for SAFRA review. This is as far as a partner can move
   * a listing toward being live — approval is a staff action (§8.1).
   */
  async submitForReview(claims: AccessTokenClaims | undefined, reference: string) {
    const partnerId = requirePartnerId(claims, P.PROPERTY_MANAGE_OWN);
    const property = await this.findOwned(partnerId, reference);

    if (property.status !== 'draft' && property.status !== 'rejected') {
      throw conflict(ERROR.PROPERTY_NOT_SUBMITTABLE);
    }

    // A listing with no bookable unit cannot be reviewed meaningfully.
    const units = await this.db.query.units.findMany({
      where: and(
        eq(schema.units.propertyId, property.id),
        isNull(schema.units.deletedAt),
      ),
      columns: { id: true },
    });

    if (units.length === 0) {
      throw badRequest(ERROR.PROPERTY_UNIT_REQUIRED);
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.properties)
        .set({ status: 'pending_review' })
        .where(eq(schema.properties.id, property.id));

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'property.submitted_for_review',
          subjectType: 'property',
          subjectId: property.id,
          before: { status: property.status },
          after: { status: 'pending_review' },
        },
        tx as unknown as Database,
      );

      await tx.insert(schema.timelineEvents).values({
        subjectType: 'property',
        subjectId: property.id,
        eventType: 'property.submitted_for_review',
        actorType: 'partner',
        actorUserId: claims?.sub ?? null,
      });
    });

    return { reference, status: 'pending_review' as const };
  }

  // ── Units ─────────────────────────────────────────────────────────────────

  async addUnit(
    claims: AccessTokenClaims | undefined,
    propertyReference: string,
    input: UnitCreateInput,
  ) {
    const partnerId = requirePartnerId(claims, P.PROPERTY_MANAGE_OWN);
    const property = await this.findOwned(partnerId, propertyReference);

    /*
      A unit carries a base price, so creating one IS setting a price — the same sentence the
      controller uses about verification, and it decides this too. `basePrice` is required by
      `unitCreateSchema`, so there is no version of this call that does not set one.
    */
    assertMayPrice(claims, true);

    const currency = await this.db.query.currencies.findFirst({
      where: eq(schema.currencies.code, input.currencyCode.toUpperCase()),
      columns: { id: true },
    });

    if (!currency) throw badRequest(ERROR.GEO_CURRENCY_UNKNOWN);

    const amenityIds = await this.resolveAmenityIds(input.amenityCodes);

    const unitId = await this.db.transaction(async (tx) => {
      const [unit] = await tx
        .insert(schema.units)
        .values({
          propertyId: property.id,
          nameAr: input.name.ar,
          nameEn: input.name.en ?? input.name.ar,
          nameDe: input.name.de ?? input.name.ar,
          maxGuests: input.maxGuests,
          bedrooms: input.bedrooms,
          beds: input.beds,
          bathrooms: input.bathrooms,
          basePrice: input.basePrice.toFixed(2),
          currencyId: currency.id,
          minNights: input.minNights,
          maxNights: input.maxNights ?? null,
          roomTypeCode: input.roomTypeCode ?? null,
          unitLabel: input.unitLabel ?? null,
        })
        .returning({ id: schema.units.id });

      if (!unit) throw new Error('Unit insert returned no row.');

      if (amenityIds.length > 0) {
        await tx
          .insert(schema.unitAmenities)
          .values(amenityIds.map((amenityId) => ({ unitId: unit.id, amenityId })));
      }

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'unit.created',
          subjectType: 'unit',
          subjectId: unit.id,
          after: {
            propertyReference,
            maxGuests: input.maxGuests,
            basePrice: input.basePrice,
          },
        },
        tx as unknown as Database,
      );

      return unit.id;
    });

    return { unitId, propertyReference };
  }

  async updateUnit(
    claims: AccessTokenClaims | undefined,
    unitId: string,
    input: UnitUpdateInput,
  ) {
    const partnerId = requirePartnerId(claims, P.PROPERTY_MANAGE_OWN);
    await this.assertOwnsUnit(partnerId, unitId);
    /* After ownership, so this cannot be used to probe which units exist. */
    assertMayPrice(claims, input.basePrice !== undefined);

    const patch: Record<string, unknown> = {};

    if (input.name) {
      patch['nameAr'] = input.name.ar;
      if (input.name.en) patch['nameEn'] = input.name.en;
      if (input.name.de) patch['nameDe'] = input.name.de;
    }
    if (input.maxGuests !== undefined) patch['maxGuests'] = input.maxGuests;
    if (input.bedrooms !== undefined) patch['bedrooms'] = input.bedrooms;
    if (input.beds !== undefined) patch['beds'] = input.beds;
    if (input.bathrooms !== undefined) patch['bathrooms'] = input.bathrooms;
    // Price is stored as a fixed-scale string; never a float (rule 1).
    if (input.basePrice !== undefined) patch['basePrice'] = input.basePrice.toFixed(2);
    if (input.minNights !== undefined) patch['minNights'] = input.minNights;
    if (input.maxNights !== undefined) patch['maxNights'] = input.maxNights;
    if (input.roomTypeCode !== undefined) patch['roomTypeCode'] = input.roomTypeCode;
    if (input.unitLabel !== undefined) patch['unitLabel'] = input.unitLabel;
    if (input.isActive !== undefined) patch['isActive'] = input.isActive;

    if (Object.keys(patch).length === 0 && input.amenityCodes === undefined) {
      throw badRequest(ERROR.SETTING_NO_UPDATABLE_FIELDS);
    }

    await this.db.transaction(async (tx) => {
      if (Object.keys(patch).length > 0) {
        await tx.update(schema.units).set(patch).where(eq(schema.units.id, unitId));
      }

      if (input.amenityCodes !== undefined) {
        const amenityIds = await this.resolveAmenityIds(input.amenityCodes);
        // Amenities are a set: replace wholesale rather than diffing, so the
        // result always matches exactly what the partner submitted.
        await tx
          .delete(schema.unitAmenities)
          .where(eq(schema.unitAmenities.unitId, unitId));
        if (amenityIds.length > 0) {
          await tx
            .insert(schema.unitAmenities)
            .values(amenityIds.map((amenityId) => ({ unitId, amenityId })));
        }
      }

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'unit.updated',
          subjectType: 'unit',
          subjectId: unitId,
          after: { ...patch, amenityCodes: input.amenityCodes },
        },
        tx as unknown as Database,
      );
    });

    return { unitId, updated: Object.keys(patch) };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Loads a property the caller owns, or 404s.
   *
   * Ownership is part of the WHERE clause, and a property belonging to a different
   * partner is reported as "not found" rather than "forbidden" — a 403 would
   * confirm that reference exists, and references are sequential.
   */
  private async findOwned(partnerId: string, reference: string) {
    const property = await this.db.query.properties.findFirst({
      where: and(
        eq(schema.properties.reference, reference),
        eq(schema.properties.partnerId, partnerId),
        isNull(schema.properties.deletedAt),
      ),
      columns: { id: true, status: true, slug: true },
      /*
        The TYPE, because the star classification is a hotel classification and `update` has to
        know what kind of place this is. Only the code — one text column through an existing
        foreign key, on a read that already runs.
      */
      with: { propertyType: { columns: { code: true } } },
    });

    if (!property) throw notFound(ERROR.PROPERTY_NOT_FOUND);

    return property;
  }

  /** Units are owned transitively, through their property. */
  private async assertOwnsUnit(partnerId: string, unitId: string): Promise<void> {
    const rows = await this.db
      .select({ id: schema.units.id })
      .from(schema.units)
      .innerJoin(schema.properties, eq(schema.properties.id, schema.units.propertyId))
      .where(
        and(
          eq(schema.units.id, unitId),
          eq(schema.properties.partnerId, partnerId),
          isNull(schema.units.deletedAt),
          isNull(schema.properties.deletedAt),
        ),
      )
      .limit(1);

    if (rows.length === 0) throw notFound(ERROR.UNIT_NOT_FOUND);
  }

  private async resolveAmenityIds(codes: string[]): Promise<string[]> {
    if (codes.length === 0) return [];

    const found = await this.db.query.amenities.findMany({
      where: (a, { inArray }) => inArray(a.code, codes),
      columns: { id: true, code: true },
    });

    const missing = codes.filter((c) => !found.some((f) => f.code === c));
    if (missing.length > 0) {
      throw badRequest(ERROR.PROPERTY_AMENITIES_UNKNOWN);
    }

    return found.map((f) => f.id);
  }

  /**
   * Slugs feed the SEO property URL, so they are derived from the name and made
   * unique with a numeric suffix. Arabic names transliterate poorly, so an English
   * name is preferred when present, with a reference-based fallback rather than a
   * mangled slug.
   */
  private async uniqueSlug(nameAr: string, nameEn?: string): Promise<string> {
    const base =
      slugify(nameEn ?? '') || slugify(nameAr) || `property-${Date.now().toString(36)}`;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;

      const clash = await this.db.query.properties.findFirst({
        where: and(
          eq(schema.properties.slug, candidate),
          isNull(schema.properties.deletedAt),
        ),
        columns: { id: true },
      });

      if (!clash) return candidate;
    }

    throw conflict(ERROR.PROPERTY_SLUG_NOT_DERIVABLE);
  }
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      // Latin letters, digits and separators only. Arabic script is dropped here by
      // design; the Arabic name still drives the page title and content.
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 70)
      .replace(/^-|-$/g, '')
  );
}
