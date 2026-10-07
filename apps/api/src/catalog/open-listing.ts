import { sql, type SQL } from 'drizzle-orm';

/**
 * Whether a listing is OPEN to the public: published, not deleted, in an open city of an open
 * country, and offered by a partner who is not suspended.
 *
 * ## One predicate for every door (audit 2026-10-06)
 *
 * Search has applied all four conditions since 2026-10-04, and nothing else did. Closing a market
 * or suspending a partner therefore took the listings out of the results and left them bookable:
 * the property page still rendered, the quote still priced, the booking was still created, and a
 * customer who had saved the listing walked straight from المفضلة to the checkout. Hiding a thing
 * from one page is not closing it; every path that ends in a quote or a booking has to ask the same
 * question, so the question is written once, here.
 *
 * Search keeps its own copy inside `buildSearchFilters`, deliberately: its scope is tuned for the
 * planner on a 25 GB dataset and was measured as written. Its integration tests cover the same four
 * conditions.
 *
 * ## Not found, never «closed»
 *
 * Every caller turns a closed listing into the same answer an absent one gets. Telling a stranger
 * that a named business is suspended is a disclosure the suspension policy never intended, and a
 * distinct answer would let anybody enumerate suspended partners by probing their slugs.
 *
 * Takes the PROPERTY alias as SQL (for example sql`p`), so it composes into any query that has the
 * property in scope. Every lookup inside is by primary key.
 */
export function openListing(property: SQL): SQL {
  return sql`(
    ${property}.status = 'published'
    AND ${property}.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM cities open_city
      JOIN countries open_country ON open_country.id = open_city.country_id
      WHERE open_city.id = ${property}.city_id
        AND open_city.is_active AND open_city.deleted_at IS NULL
        AND open_country.is_active AND open_country.deleted_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM partners closed_partner
      WHERE closed_partner.id = ${property}.partner_id
        AND closed_partner.suspended_at IS NOT NULL
    )
  )`;
}
