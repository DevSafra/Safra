import { sql, type SQL } from 'drizzle-orm';

import type { SearchQuery } from '@safra/contracts';
import { BLOCKING_STATUS_SQL } from '../bookings/booking-state.js';

/**
 * The search's predicates, each written ONCE and named (Bashar, 2026-10-01).
 *
 * ## Why they live here rather than inside the query
 *
 * The results list and the filter counts beside it must agree: «٥ نجوم (12)» has to be exactly the
 * twelve stays ticking it returns. A count built from a separately written predicate DRIFTS from
 * the list it describes — the rule the console's tables state for `fromWhere`. So both the search
 * and the facet counts compose these fragments, and neither has a copy of its own.
 *
 * ## The shape
 *
 * `scope` is what makes a unit a candidate for THIS search at all: published, not suspended, big
 * enough for the party, the right length of stay, free on those dates, in the city and the area
 * asked about. It is the search, not a filter, so it is never relaxed.
 *
 * Every other field is one sidebar group, as an `AND …` fragment that is empty when the group is
 * not in use. Search ANDs them all. The facet query evaluates each one as a flag, `(TRUE ${…})`,
 * so a group's own counts can ignore its own selection — ticking «٤ نجوم» must not zero the count
 * beside «٥ نجوم», or the reader could never widen a filter they had set.
 *
 * Every fragment references the aliases `u` (units) and `p` (properties), and the `centres` CTE.
 */
export interface SearchFilters {
  scope: SQL;
  propertyType: SQL;
  stars: SQL;
  rating: SQL;
  bathrooms: SQL;
  bedType: SQL;
  centre: SQL;
  freeCancellation: SQL;
  attributes: SQL;
  amenities: SQL;
}

/** The facet groups, in the order the sidebar shows them. */
export type FilterGroup = Exclude<keyof SearchFilters, 'scope'>;

export const FILTER_GROUPS: readonly FilterGroup[] = [
  'propertyType',
  'stars',
  'rating',
  'bathrooms',
  'bedType',
  'centre',
  'freeCancellation',
  'attributes',
  'amenities',
];

/**
 * A policy that refunds in full at SOME notice. Tiers are stored in no particular order — the
 * refund service sorts them — so the first tier says nothing about the policy, and reading it
 * misjudged a ladder written latest-first. Takes the tiers column expression.
 */
export function freeTier(tiers: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM jsonb_array_elements(${tiers}) tier
    WHERE (tier ->> 'refundPercent')::int = 100
  )`;
}

export function buildSearchFilters(
  query: SearchQuery,
  context: {
    guests: number;
    nights: number;
    nearFilter: SQL;
    kindFilter: SQL;
    boxFilter: SQL;
  },
): SearchFilters {
  const { guests, nights } = context;

  const scope = sql`u.is_active
          AND u.deleted_at IS NULL
          AND p.deleted_at IS NULL
          -- §8.1 / P-002: only verified, published inventory is ever searchable.
          AND p.status = 'published'
          /*
            A SUSPENDED partner's listings leave search and discovery (Bashar, 2026-08-24).

            The first clause of the suspension policy, and the only one enforced on a path a
            CUSTOMER walks — everything else suspension does is refused at a partner's own write.
            This join did not exist: search referenced no partner table at all, which is why hiding
            the listings was a new predicate rather than a changed one.

            Not a soft delete: a suspension is reversible and the listing comes straight back when
            it is lifted, which is the difference between a lever and a deletion.

            No backticks in this comment — it sits inside a sql template literal and a backtick ends
            it. Fourth time today.
          */
          AND NOT EXISTS (
            SELECT 1 FROM partners sp
            WHERE sp.id = p.partner_id AND sp.suspended_at IS NOT NULL
          )
          AND u.max_guests >= ${guests}
          -- Zero is «no requirement», so the predicate is omitted rather than written as a
          -- constant-true comparison: the planner would still carry it through every candidate row.
          -- (No backticks in this comment. See the note above — that is now the fifth time.)
          ${query.bedrooms > 0 ? sql`AND u.bedrooms >= ${query.bedrooms}` : sql``}
          AND ${nights} >= u.min_nights
          AND (u.max_nights IS NULL OR ${nights} <= u.max_nights)

          -- ── Narrow BEFORE pricing ────────────────────────────────────────
          --
          -- City, type and cancellation policy are properties of the PROPERTY, and they used to be
          -- applied in candidates — after every unit in the country had already been priced and
          -- had its availability checked. So a search of one city did the work of a search of all
          -- of them, and properties_published_idx, which exists precisely for
          -- (city_id, recommendation_score) over published rows, could never be used.
          --
          -- They are repeated in candidates rather than moved. Applying the same predicate twice
          -- cannot change the result, and it means this optimisation cannot quietly alter what a
          -- guest sees if one of these is not exactly equivalent to the join it mirrors.
          ${
            query.citySlug
              ? sql`AND p.city_id = (
                      SELECT id FROM cities WHERE slug = ${query.citySlug} AND deleted_at IS NULL
                    )`
              : sql``
          }
          -- The proximity filters, applied here for the same reason city and type are: each is a
          -- predicate on the PROPERTY, and running them before pricing is the difference between
          -- pricing the listings near a landmark and pricing every unit in the country.
          ${context.nearFilter}
          ${context.kindFilter}
          ${context.boxFilter}

          -- Anti-join 1: the calendar says no.
          --
          -- Two rules over the same rows, so ONE scan rather than two: a day in the range that is
          -- closed, booked or under maintenance, OR an arrival day carrying a minimum-nights
          -- override this stay is too short for. They were separate NOT EXISTS clauses, each
          -- opening its own index scan on (unit_id, date) for every candidate unit — and at 200,000
          -- units an unfiltered search made 450,000 lookups into a 73-million-row table.
          --
          -- The union of the two predicates is the union of the two excluded sets, so this is the
          -- same set of units. The min-nights term keeps its date = arrival restriction, which is
          -- inside the range being scanned.
          --
          -- An ABSENT row means available — §8.4 puts the burden on the partner to close dates, so
          -- units are open by default rather than needing 365 rows before a listing can sell.
          AND NOT EXISTS (
            SELECT 1 FROM availability_days ad
            WHERE ad.unit_id = u.id
              AND ad.date >= ${query.checkIn}::date
              AND ad.date <  ${query.checkOut}::date
              AND (
                ad.status <> 'available'
                OR (
                  ad.date = ${query.checkIn}::date
                  AND ad.min_nights IS NOT NULL
                  AND ${nights} < ad.min_nights
                )
              )
          )

          -- Anti-join 2: no live booking overlaps. Uses the same '[)' bound as the
          -- exclusion constraint, so search and the constraint can never disagree
          -- about what "overlapping" means.
          --
          -- booking_units, not bookings: a booking of four suites NAMES one of
          -- them and HOLDS four, so reading the booking row would offer the other
          -- three to somebody else. Every booking has a row here whatever created
          -- it — the bookings_hold_lead_room trigger sees to that.
          AND NOT EXISTS (
            SELECT 1 FROM booking_units b
            WHERE b.unit_id = u.id
              AND b.status IN ${BLOCKING_STATUS_SQL}
              AND daterange(b.check_in, b.check_out, '[)')
                  && daterange(${query.checkIn}::date, ${query.checkOut}::date, '[)')
          )`;

  return {
    scope,

    propertyType: query.propertyTypeCode
      ? sql`AND p.property_type_id = (
              SELECT id FROM property_types WHERE code = ${query.propertyTypeCode}
            )`
      : sql``,

    /*
      Star classification, ORed within the filter (Bashar, 2026-09-04).

      IN rather than a chain of ANDs, because a property has exactly ONE classification: requiring
      all of a multi-select would return nothing the moment a second box was ticked. Each value
      bound individually — the same reason the attribute filter does, and the same reason it must
      not become a joined string.

      A listing with NO classification is excluded when the filter is on. That is the honest answer
      to "show me 4-star hotels": a listing nobody has classified is not known to be one.
    */
    stars:
      query.starRatings.length > 0
        ? sql`AND p.star_rating IN (${sql.join(
            query.starRatings.map((one) => sql`${one}`),
            sql`, `,
          )})`
        : sql``,

    /*
      The GUEST score, a property column on SAFRA's 1-5 scale. A listing nobody has reviewed has no
      score and so cannot be shown to meet one.
    */
    rating:
      query.minRating !== undefined ? sql`AND p.rating >= ${query.minRating}` : sql``,

    /* Bathrooms and bed type are facts of the UNIT, so they narrow before pricing like bedrooms. */
    bathrooms:
      query.minBathrooms > 0 ? sql`AND u.bathrooms >= ${query.minBathrooms}` : sql``,
    bedType: query.bedType ? sql`AND u.bed_type = ${query.bedType}` : sql``,

    /*
      Distance from the city's centre, measured to the same city_centre landmark every card's
      «كم من وسط المدينة» line uses, from the PUBLIC pair, so the filter and the figure agree.
    */
    centre:
      query.maxCentreKm !== undefined
        ? sql`AND p.public_latitude IS NOT NULL AND EXISTS (
            SELECT 1 FROM centres cc
            WHERE cc.city_id = p.city_id
              AND (6371008.8 * 2 * asin(sqrt(
                power(sin(radians(cc.latitude - p.public_latitude) / 2), 2)
                + cos(radians(p.public_latitude)) * cos(radians(cc.latitude))
                  * power(sin(radians(cc.longitude - p.public_longitude) / 2), 2)
              ))) <= ${query.maxCentreKm * 1000}::numeric
          )`
        : sql``,

    freeCancellation: query.freeCancellationOnly
      ? sql`AND p.cancellation_policy_id IN (
              SELECT id FROM cancellation_policies WHERE ${freeTier(sql`tiers`)}
            )`
      : sql``,

    /*
      §5.2 trip attributes. The containment operator requires the property to carry ALL selected
      attributes, matching how the amenity filter behaves — a multi-select that silently ORed would
      surprise anyone narrowing a search on purpose.

      Each element is bound individually. Passing the JS array directly makes drizzle emit a row
      constructor, which Postgres cannot cast to text[] — "cannot cast type record to text[]".
    */
    attributes:
      query.attributes.length > 0
        ? sql`AND p.attributes @> ARRAY[${sql.join(
            query.attributes.map((a) => sql`${a}`),
            sql`, `,
          )}]::text[]`
        : sql``,

    /*
      EITHER level satisfies a filter (Bashar, 2026-09-06).

      A guest ticking «مسبح» means the building has one; ticking «شرفة» means the room does. They
      are the same control and the customer does not think of them as two questions, so the filter
      counts distinct codes across the UNION of what the unit declares and what its property
      declares. DISTINCT over the union, so a code held at BOTH levels counts once and cannot make a
      two-filter search pass on one satisfied filter.
    */
    amenities:
      query.amenityCodes.length > 0
        ? sql`AND (
            SELECT COUNT(DISTINCT a.code)
            FROM (
              SELECT ua.amenity_id FROM unit_amenities ua WHERE ua.unit_id = u.id
              UNION
              SELECT pa.amenity_id FROM property_amenities pa
               WHERE pa.property_id = u.property_id
            ) held
            JOIN amenities a ON a.id = held.amenity_id
            WHERE a.code IN ${query.amenityCodes}
          ) = ${query.amenityCodes.length}`
        : sql``,
  };
}

/**
 * The city centres CTE body every query using `centre` needs. One point per city: the city_centre
 * landmark the card measures to. A handful of rows, materialised once per query.
 */
export const CENTRES_CTE = sql`centres AS MATERIALIZED (
        SELECT DISTINCT ON (lc.city_id) lc.city_id, lc.latitude, lc.longitude
        FROM landmarks lc
        JOIN landmark_kinds lk ON lk.id = lc.kind_id
        WHERE lk.code = 'city_centre'
          AND lk.is_active AND lk.deleted_at IS NULL
          AND lc.is_active AND lc.deleted_at IS NULL
        ORDER BY lc.city_id, lc.sort_order, lc.slug
      )`;
