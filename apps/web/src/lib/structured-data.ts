/**
 * schema.org graphs, built as plain data (Bashar, 2026-09-29).
 *
 * «I want search engines to receive structured, machine-readable information wherever it provides
 * value.» Value, not everywhere: a graph that restates the visible page teaches a crawler nothing
 * and is one more thing to keep in step. What is here earns a RICH RESULT — an FAQ accordion, a
 * star rating under a listing, a breadcrumb trail, a trip's dates and price — or it is a `Place`
 * that disambiguates a name search engines otherwise have to guess at.
 *
 * ## Builders rather than JSX
 *
 * Every function here is pure: page data in, a JSON-LD object out. That is what makes the privacy
 * rule testable — `structured-data.test.ts` walks the entire produced graph for a coordinate and
 * for an address, and a walk over a returned object is a far stronger assertion than a grep over a
 * component. A builder that quietly started emitting `geo` would be caught by a test rather than
 * by somebody reading rendered HTML.
 *
 * ## The rule this file exists under
 *
 * **No exact property location ever reaches this output.** Not `geo`, not a `streetAddress`, not
 * the approximate district string. `addressLocality` is the CITY and `addressCountry` is the
 * country — both of which a listing's own page states in its heading. A JSON-LD `geo` invites a
 * search engine to draw a PIN, which reads as precision we do not have and must not imply, even
 * though the coordinate we hold is already rounded. See `location-privacy.integration.test.ts` for
 * the server-side half of the same rule.
 */

/**
 * A `PostalAddress` with only the parts we actually hold.
 *
 * An empty `addressCountry: ''` is not a smaller version of the right answer — it is a claim that
 * the country is the empty string, and a consumer that trusts it produces a listing filed under
 * nowhere. A reference read can fail, so «locality but no country» is a real state, and this drops
 * the key rather than publishing a blank.
 *
 * `streetAddress` is not a parameter at all. Not omitted-when-empty, not optional: absent from the
 * signature, so no caller can pass one by accident. That is the privacy rule made structural
 * rather than remembered.
 */
function postalAddress(parts: {
  readonly locality?: string;
  readonly countryCode: string;
}): Graph {
  return {
    '@type': 'PostalAddress',
    ...(parts.locality ? { addressLocality: parts.locality } : {}),
    ...(parts.countryCode ? { addressCountry: parts.countryCode } : {}),
  };
}

/** Every builder returns this shape; `JsonLd` is the only consumer. */
export type Graph = Record<string, unknown>;

type Translated = { ar: string | null; en: string | null; de: string | null };

/**
 * A `FAQPage` — the highest-value graph on the site.
 *
 * Google draws an expandable accordion straight in the result for this one, which is why the FAQ
 * work of 2026-09-28 is worth describing to a crawler at all. `mainEntity` must be non-empty:
 * an FAQPage with no questions is a page claiming to be something it is not, so the caller gets
 * null and renders nothing.
 */
export function faqGraph(
  items: readonly { question: string; answer: string }[],
): Graph | null {
  const usable = items.filter((one) => one.question !== '' && one.answer !== '');

  if (usable.length === 0) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: usable.map((one) => ({
      '@type': 'Question',
      name: one.question,
      acceptedAnswer: { '@type': 'Answer', text: one.answer },
    })),
  };
}

/**
 * A stay.
 *
 * `LodgingBusiness` rather than `Hotel`, because the type covers apartments, villas, chalets and
 * farms too — SAFRA lists seven property kinds and calling a farm a Hotel is a claim about it that
 * schema.org offers a correct word for.
 *
 * `aggregateRating` is emitted ONLY with a real review count. Google treats a rating with no
 * reviews behind it as a policy violation, and it is also simply false: «٠ تقييمات» beside four
 * gold stars is the shape a rating widget takes before anybody has said anything.
 */
export function lodgingGraph(input: {
  readonly name: string;
  readonly description: string | null;
  readonly url: string;
  readonly cityName: string;
  readonly countryCode: string;
  readonly images: readonly string[];
  readonly starRating: number | null;
  readonly rating: string | null;
  readonly reviewsCount: number;
  readonly priceFrom: { amount: string; currency: string } | null;
}): Graph {
  const score = Number(input.rating ?? '');

  return {
    '@context': 'https://schema.org',
    '@type': 'LodgingBusiness',
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    url: input.url,
    ...(input.images.length > 0 ? { image: [...input.images] } : {}),
    /*
      City and country, and deliberately nothing finer. `streetAddress` is absent because we do not
      publish one before a booking is confirmed, and `geo` is absent because a pin implies a
      precision the rounded coordinate does not have. This is the whole privacy surface of this
      file — see the note at the top.
    */
    address: postalAddress({
      locality: input.cityName,
      countryCode: input.countryCode,
    }),
    ...(input.starRating
      ? {
          starRating: { '@type': 'Rating', ratingValue: input.starRating, bestRating: 5 },
        }
      : {}),
    ...(Number.isFinite(score) && score > 0 && input.reviewsCount > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: score,
            reviewCount: input.reviewsCount,
            bestRating: 5,
          },
        }
      : {}),
    ...(input.priceFrom
      ? {
          /*
            An offer, not a `priceRange` string. `priceRange` is free text («$$»), which says
            nothing a machine can compare; `lowPrice` with its currency is the figure a traveller
            searched for. The currency is never omitted — the money rule applies to a graph a
            person's search result will render exactly as it applies to a screen.
          */
          makesOffer: {
            '@type': 'Offer',
            priceCurrency: input.priceFrom.currency,
            price: input.priceFrom.amount,
            availability: 'https://schema.org/InStock',
          },
        }
      : {}),
  };
}

/**
 * A city, as a destination rather than a mere `Place`.
 *
 * `TouristDestination` is a subtype of `Place` and says what the page is FOR. The city's own
 * coordinates are not published here either — not for privacy, since a city's location is hardly
 * secret, but because SAFRA does not hold a city centroid it stands behind, and a fabricated one
 * is worse than none.
 */
export function cityGraph(input: {
  readonly name: string;
  readonly description: string | null;
  readonly url: string;
  readonly countryCode: string;
  readonly images: readonly string[];
}): Graph {
  return {
    '@context': 'https://schema.org',
    '@type': 'TouristDestination',
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    url: input.url,
    ...(input.images.length > 0 ? { image: [...input.images] } : {}),
    address: postalAddress({ countryCode: input.countryCode }),
  };
}

/**
 * A landmark.
 *
 * This is the ONE place a coordinate is published, and it is the exception that proves the rule:
 * a landmark's position is a fact SAFRA authors in the console, draws on a map, and measures
 * public distances FROM. It is not a property's location and it is not derived from one. The
 * schema comment on `landmarks` says the same thing in the other direction.
 */
export function landmarkGraph(input: {
  readonly name: string;
  readonly url: string;
  readonly cityName: string;
  readonly countryCode: string;
  readonly latitude: number;
  readonly longitude: number;
}): Graph {
  return {
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    name: input.name,
    url: input.url,
    address: postalAddress({
      locality: input.cityName,
      countryCode: input.countryCode,
    }),
    geo: {
      '@type': 'GeoCoordinates',
      latitude: input.latitude,
      longitude: input.longitude,
    },
  };
}

/**
 * A group trip.
 *
 * `TouristTrip` carries dates, a destination and an offer — the three things somebody searching
 * «رحلة جماعية إلى دمشق» wants to compare. The offer appears only WITH its currency, because a
 * price that loses its currency between five of them is not a smaller version of the right answer.
 *
 * No `availability` and no seat count in the offer: this version announces trips and does not sell
 * them, and a graph that implied a bookable inventory would be the booking engine the product
 * decision deliberately deferred, asserted to Google.
 */
export function tripGraph(input: {
  readonly name: string;
  readonly description: string | null;
  readonly url: string;
  readonly cityName: string;
  readonly countryCode: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly images: readonly string[];
  readonly priceFrom: { amount: string; currency: string } | null;
}): Graph {
  return {
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    url: input.url,
    ...(input.images.length > 0 ? { image: [...input.images] } : {}),
    startDate: input.startsOn,
    endDate: input.endsOn,
    itinerary: {
      '@type': 'Place',
      name: input.cityName,
      address: postalAddress({
        locality: input.cityName,
        countryCode: input.countryCode,
      }),
    },
    ...(input.priceFrom
      ? {
          offers: {
            '@type': 'Offer',
            priceCurrency: input.priceFrom.currency,
            price: input.priceFrom.amount,
          },
        }
      : {}),
  };
}

/**
 * The trail a reader followed, which is what Google prints instead of a raw URL.
 *
 * Positions are 1-based and must be contiguous, so the list is built from the caller's order
 * rather than from anything the request carried. Every URL here is absolute: a relative `item` is
 * silently dropped by the consumers of this vocabulary, and nothing would say so.
 */
export function breadcrumbGraph(
  trail: readonly { name: string; url: string }[],
): Graph | null {
  if (trail.length < 2) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: step.name,
      item: step.url,
    })),
  };
}

/** Picks the reader's language, falling back to the authored Arabic — the site-wide rule. */
export function pick(value: Translated, locale: 'ar' | 'en' | 'de'): string {
  if (locale === 'en') return value.en?.trim() || value.ar || '';
  if (locale === 'de') return value.de?.trim() || value.ar || '';

  return value.ar || '';
}
