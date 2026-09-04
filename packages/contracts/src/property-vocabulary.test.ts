import { describe, expect, it } from 'vitest';

import { propertyCreateSchema, propertyUpdateSchema } from './property.js';
import { TRIP_ATTRIBUTES } from './search.js';

/**
 * A partner tags a listing from SAFRA's vocabulary, never their own.
 *
 * ## Why this is asserted rather than assumed
 *
 * «الفئات should be displayed on the entire system … and the partner can not use his own
 * tags/فئات» (Bashar, 2026-08-30). The picker in the partner app renders `TRIP_ATTRIBUTES`, which
 * is right and is a COURTESY: the standing rule is to assume the attribute is gone — somebody
 * edits the DOM, replays the form, or posts JSON by hand — and ask what the server then does.
 *
 * The server's answer is this schema, and nothing tested it. A `z.array(z.string())` slipped in
 * during a refactor would leave the picker looking identical, the suite green, and
 * `properties.attributes` filling with tags no customer can search for and no filter can offer —
 * which is exactly the free-form tagging this rule forbids.
 *
 * Both directions are asserted, because a vocabulary that only holds on CREATE is not a
 * vocabulary: `propertyUpdateSchema` is `.partial()` of the same object, and a partial that
 * loosened its element type would let a partner rename their way out of the list on the second
 * save.
 */
describe('the trip-attribute vocabulary is closed', () => {
  const valid = {
    citySlug: 'damascus',
    propertyTypeCode: 'hotel',
    cancellationPolicyCode: 'flexible',
    name: { ar: 'بيت', en: 'House', de: 'Haus' },
    description: { ar: 'وصف', en: 'Description', de: 'Beschreibung' },
    address: 'شارع ١',
    /* Required since 2026-09-04 — every new listing declares its classification. */
    starRating: 4,
  };

  it('accepts every attribute the platform publishes', () => {
    const parsed = propertyCreateSchema.safeParse({
      ...valid,
      attributes: [...TRIP_ATTRIBUTES],
    });

    /* The opposite control: without it, a schema refusing EVERYTHING would pass the test below. */
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('refuses a tag of the partner’s own on create', () => {
    const parsed = propertyCreateSchema.safeParse({
      ...valid,
      attributes: ['sea', 'luxury-boutique-retreat'],
    });

    expect(parsed.success).toBe(false);
  });

  it('refuses a tag of the partner’s own on update', () => {
    const parsed = propertyUpdateSchema.safeParse({
      attributes: ['spa-and-wellness'],
    });

    expect(parsed.success).toBe(false);
  });

  it('refuses a city category as a trip attribute', () => {
    /*
      The two vocabularies are NOT interchangeable, and this is the confusion worth pinning: a
      city is «ساحلية», a listing is «sea». A partner who could file a listing under a CITY
      category would be classifying the destination, which is SAFRA's decision and is made on
      الفئات — the console screen, on rows no partner can reach.
    */
    const parsed = propertyCreateSchema.safeParse({
      ...valid,
      attributes: ['coastal'],
    });

    expect(parsed.success).toBe(false);
  });
});
