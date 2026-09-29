import { describe, expect, it } from 'vitest';

import { serialise } from '@/components/json-ld';
import {
  breadcrumbGraph,
  cityGraph,
  faqGraph,
  landmarkGraph,
  lodgingGraph,
  tripGraph,
  type Graph,
} from './structured-data';

/**
 * What we tell a search engine, and what we must never tell it.
 *
 * ## The privacy half is a WALK, not a string check
 *
 * `not.toContain('34.8')` protects the one string it names and nothing else — the lesson
 * `safra-security-tests-need-an-opposite-control` records about a privacy assertion that stayed
 * green while a full name started shipping beside the email it was watching. So these cases walk
 * every key and every value of the produced object and ask the GENERAL question: is there a
 * coordinate anywhere, is there a street address anywhere. A builder that grows a `geo` next year
 * fails here without anybody remembering to update a list.
 */

/** Every key in the graph, at every depth. */
function keysOf(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.push(key);
      keysOf(inner, into);
    }
  }

  return into;
}

const LOCATION_KEYS = [
  'geo',
  'latitude',
  'longitude',
  'streetAddress',
  'postalCode',
  'hasMap',
  'addressRegion',
];

describe('a stay never carries its location', () => {
  const stay = (over: Partial<Parameters<typeof lodgingGraph>[0]> = {}): Graph =>
    lodgingGraph({
      name: 'فندق أمية الكبير',
      description: 'فندق في قلب دمشق.',
      url: 'https://safra.test/ar/property/grand-umayyad-hotel',
      cityName: 'دمشق',
      countryCode: 'SY',
      images: ['https://media.test/a-1600.webp'],
      starRating: 4,
      rating: '4.7',
      reviewsCount: 12,
      priceFrom: { amount: '73.99', currency: 'USD' },
      ...over,
    });

  it('publishes no coordinate and no street address, at any depth', () => {
    const keys = keysOf(stay());

    for (const forbidden of LOCATION_KEYS) {
      expect(keys, `a stay must not publish ${forbidden}`).not.toContain(forbidden);
    }
  });

  /*
    The opposite control. Without it «no coordinate» would pass just as happily over an EMPTY
    graph — which is what a broken builder produces, and it would report privacy while shipping
    nothing at all.
  */
  it('still says the things it is supposed to say', () => {
    const keys = keysOf(stay());

    expect(keys).toContain('addressLocality');
    expect(keys).toContain('addressCountry');
    expect(stay()['name']).toBe('فندق أمية الكبير');
  });

  /*
    A reference read can fail, and «the country is the empty string» is a claim, not an absence.
    Without this the graph would file a listing under nowhere and look perfectly well-formed.
  */
  it('omits an address part it does not hold rather than publishing a blank', () => {
    const address = stay({ countryCode: '' })['address'] as Record<string, unknown>;

    expect(Object.keys(address)).not.toContain('addressCountry');
    expect(address['addressLocality'], 'the part we DO hold is still published').toBe(
      'دمشق',
    );
  });

  it('withholds a rating nobody has given', () => {
    expect(keysOf(stay({ rating: null, reviewsCount: 0 }))).not.toContain(
      'aggregateRating',
    );
    /* And the control: a real one IS published, or the assertion above proves nothing. */
    expect(keysOf(stay())).toContain('aggregateRating');
  });

  /*
    A rating with no reviews behind it is both a Google policy violation and simply false. The
    two conditions are separate because the API can send either alone.
  */
  it('withholds a rating that has a score but no reviews', () => {
    expect(keysOf(stay({ rating: '4.7', reviewsCount: 0 }))).not.toContain(
      'aggregateRating',
    );
  });

  it('never states a price without its currency', () => {
    const offer = stay()['makesOffer'] as Record<string, unknown>;

    expect(offer['price']).toBe('73.99');
    expect(
      offer['priceCurrency'],
      'an amount with no currency is the forbidden shape',
    ).toBe('USD');

    /* With no price there is no offer at all, rather than an offer carrying a bare number. */
    expect(keysOf(stay({ priceFrom: null }))).not.toContain('makesOffer');
  });
});

describe('the landmark is the one place a coordinate is published', () => {
  const graph = landmarkGraph({
    name: 'سوق الحميدية',
    url: 'https://safra.test/ar/landmark/souq-al-hamidiyah',
    cityName: 'دمشق',
    countryCode: 'SY',
    latitude: 33.5117,
    longitude: 36.3003,
  });

  /*
    Asserted rather than assumed, because it is the deliberate exception: a landmark's position is
    authored by staff, drawn on a map and used as the origin of every public distance. If this ever
    stopped being true the exception would need re-arguing, and a green test is how that gets
    noticed.
  */
  it('carries the landmark position it was given', () => {
    const geo = graph['geo'] as Record<string, unknown>;

    expect(geo['latitude']).toBe(33.5117);
    expect(geo['longitude']).toBe(36.3003);
  });
});

describe('an FAQ graph', () => {
  it('is null when there is nothing to ask', () => {
    expect(faqGraph([])).toBeNull();
    expect(faqGraph([{ question: '', answer: 'شيء' }])).toBeNull();
  });

  it('drops a half-written entry rather than publishing an empty answer', () => {
    const graph = faqGraph([
      { question: 'هل يوجد موقف؟', answer: 'نعم.' },
      { question: 'سؤال بلا جواب', answer: '' },
    ]);

    expect((graph?.['mainEntity'] as unknown[]).length).toBe(1);
  });
});

describe('a breadcrumb', () => {
  it('is null with fewer than two steps, because one crumb is not a trail', () => {
    expect(
      breadcrumbGraph([{ name: 'الرئيسية', url: 'https://safra.test/ar' }]),
    ).toBeNull();
  });

  it('numbers its steps from one, contiguously', () => {
    const graph = breadcrumbGraph([
      { name: 'الرئيسية', url: 'https://safra.test/ar' },
      { name: 'دمشق', url: 'https://safra.test/ar/city/damascus' },
      { name: 'سوق الحميدية', url: 'https://safra.test/ar/landmark/souq-al-hamidiyah' },
    ]);

    const items = graph?.['itemListElement'] as { position: number }[];

    expect(items.map((one) => one.position)).toEqual([1, 2, 3]);
  });
});

describe('a trip graph', () => {
  const trip = (priced: boolean): Graph =>
    tripGraph({
      name: 'رحلة تدمر',
      description: null,
      url: 'https://safra.test/ar/groups/palmyra',
      cityName: 'دمشق',
      countryCode: 'SY',
      startsOn: '2027-05-01',
      endsOn: '2027-05-07',
      images: [],
      priceFrom: priced ? { amount: '450', currency: 'USD' } : null,
    });

  it('carries its dates', () => {
    expect(trip(false)['startDate']).toBe('2027-05-01');
    expect(trip(false)['endDate']).toBe('2027-05-07');
  });

  /*
    The product decision, asserted. Group Trips announce and do not sell, so the graph must not
    claim an inventory — `availability` would tell Google there are seats to book.
  */
  it('never claims a bookable inventory', () => {
    expect(keysOf(trip(true))).not.toContain('availability');
  });

  it('omits the offer entirely when there is no price', () => {
    expect(keysOf(trip(false))).not.toContain('offers');
    expect(keysOf(trip(true))).toContain('offers');
  });
});

describe('serialisation', () => {
  /*
    The breakout. A property named with a closing tag would end the script element and start
    executing whatever followed — and every value in these graphs is typed by a partner or an
    operator, so this is the ordinary case rather than a paranoid one.
  */
  it('cannot be closed by a value', () => {
    const output = serialise(
      cityGraph({
        name: '</script><img src=x onerror=alert(1)>',
        description: null,
        url: 'https://safra.test/ar/city/x',
        countryCode: 'SY',
        images: [],
      }),
    );

    expect(output).not.toContain('</script>');
    expect(output).not.toContain('<img');
    expect(output).toContain('\\u003c');

    /* And it is still valid JSON that means the same thing — the escape is not mangling. */
    expect((JSON.parse(output) as { name: string }).name).toBe(
      '</script><img src=x onerror=alert(1)>',
    );
  });
});
