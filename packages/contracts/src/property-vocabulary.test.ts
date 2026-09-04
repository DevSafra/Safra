import { describe, expect, it } from 'vitest';

import {
  propertyCreateSchema,
  propertyUpdateSchema,
  usesStarRating,
} from './property.js';
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
  };

  /**
   * ── The star classification is a HOTEL classification (Bashar, 2026-09-04) ──────────────────
   *
   * «Other accommodation types … should not use the hotel star-classification system. For
   * non-hotel accommodation types, the classification should simply be absent rather than forcing
   * an artificial star value.»
   *
   * Both directions are asserted. A hotel without one is refused, which is the requirement; a
   * villa WITH one is refused too, which is the part that is easy to leave out — silently
   * stripping a field a caller sent lets a partner believe they declared something they did not.
   */
  describe('the star classification', () => {
    const hotel = { ...valid, propertyTypeCode: 'hotel', attributes: [] };
    const villa = { ...valid, propertyTypeCode: 'villa', attributes: [] };

    it('requires one from a hotel', () => {
      const parsed = propertyCreateSchema.safeParse({ ...hotel, starRating: undefined });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.path).toEqual(['starRating']);
    });

    it('accepts one from a hotel', () => {
      expect(propertyCreateSchema.safeParse({ ...hotel, starRating: 4 }).success).toBe(
        true,
      );
    });

    it.each([1, 2, 3, 4, 5])('accepts %i stars from a hotel', (value) => {
      expect(
        propertyCreateSchema.safeParse({ ...hotel, starRating: value }).success,
      ).toBe(true);
    });

    it.each([0, 6, -1, 2.5])('refuses %s from a hotel', (value) => {
      expect(
        propertyCreateSchema.safeParse({ ...hotel, starRating: value }).success,
      ).toBe(false);
    });

    it.each(['villa', 'apartment', 'chalet', 'farm', 'camp', 'rural_house'])(
      'accepts a %s with no classification at all',
      (code) => {
        const parsed = propertyCreateSchema.safeParse({
          ...villa,
          propertyTypeCode: code,
          starRating: undefined,
        });

        expect(parsed.success).toBe(true);
      },
    );

    it.each(['villa', 'apartment', 'chalet', 'farm', 'camp', 'rural_house'])(
      'REFUSES a %s that claims a classification',
      (code) => {
        const parsed = propertyCreateSchema.safeParse({
          ...villa,
          propertyTypeCode: code,
          starRating: 5,
        });

        expect(parsed.success).toBe(false);
        expect(parsed.error?.issues[0]?.path).toEqual(['starRating']);
      },
    );

    /* The patch half a schema can judge: a type and a rating sent together. */
    it('refuses a patch that moves a listing to a villa and keeps its stars', () => {
      const parsed = propertyUpdateSchema.safeParse({
        propertyTypeCode: 'villa',
        starRating: 4,
      });

      expect(parsed.success).toBe(false);
    });

    it('accepts a patch that moves a listing to a hotel and gives it stars', () => {
      expect(
        propertyUpdateSchema.safeParse({ propertyTypeCode: 'hotel', starRating: 4 })
          .success,
      ).toBe(true);
    });

    /* `usesStarRating` is the one place the answer lives — asserted, not assumed. */
    it('names only the hotel as star-rated', () => {
      expect(usesStarRating('hotel')).toBe(true);

      for (const code of [
        'villa',
        'apartment',
        'chalet',
        'farm',
        'camp',
        'rural_house',
        'test',
      ]) {
        expect(usesStarRating(code), code).toBe(false);
      }
    });
  });

  it('accepts every attribute the platform publishes', () => {
    const parsed = propertyCreateSchema.safeParse({
      ...valid,
      /* `valid` is a hotel, and a hotel must declare its classification since 2026-09-04. */
      starRating: 4,
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
