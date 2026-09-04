import { z } from 'zod';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * Reference-data reads.
 *
 * Cached for five minutes: cities, property types and amenities change through the
 * admin panel, never per request. Search deliberately does NOT go through here —
 * caching availability would sell a room that is already taken.
 *
 * Every reader returns a usable EMPTY value on failure rather than throwing. A
 * degraded home page that still renders its search form is far better than a 500
 * because a reference endpoint blipped.
 */
async function read<T>(
  path: string,
  schema: z.ZodType<T>,
  fallback: T,
  revalidate = 300,
): Promise<T> {
  try {
    const response = await fetch(`${API_URL}/api/v1${path}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate },
    });

    if (!response.ok) return fallback;

    const parsed = schema.safeParse(await response.json());
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A city category — a ROW on الفئات, carrying its own name in all three languages.
 *
 * It was `z.array(z.string())` of codes resolved against a catalogue in this app. That froze the
 * set: a category staff add on the console has no catalogue entry, so it rendered as `riverside`
 * on a page of Arabic. Reference rows travel with their names here — `partnerTypeSchema` below
 * has done it since «انضم كشريك» shipped — and a name from the database is DATA, not copy.
 */
const cityCategorySchema = z.object({
  code: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  nameDe: z.string(),
});

export type CityCategory = z.infer<typeof cityCategorySchema>;

/**
 * The one photograph a destination card shows, or `null` where staff have uploaded none.
 *
 * `.nullable()`, never `.default()`. A default here would invent a plausible value for something
 * the API did not send, and the failure it hides is exactly the one that matters: a card drawing
 * an image element around a `fileKey` that does not exist renders a broken frame, where a real
 * `null` renders the deliberate typographic tile instead.
 */
const cityCoverSchema = z.object({
  fileKey: z.string(),
  variantWidths: z.array(z.number()),
  width: z.number().nullable(),
  height: z.number().nullable(),
  alt: z.object({
    ar: z.string().nullable(),
    en: z.string().nullable(),
    de: z.string().nullable(),
  }),
});

export type CityCover = z.infer<typeof cityCoverSchema>;

const citySchema = z.object({
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  nameDe: z.string(),
  countryCode: z.string(),
  categories: z.array(cityCategorySchema),
  cover: cityCoverSchema.nullable(),
  propertyCount: z.number(),
});

export type City = z.infer<typeof citySchema>;

export async function getCities(): Promise<City[]> {
  return read('/cities', z.array(citySchema), []);
}

/**
 * The kinds of business «انضم كشريك» offers (Bashar, 2026-08-19).
 *
 * Rows rather than a constant in this app: `partner_types` is a table precisely so that adding
 * Mobility is an INSERT — a list frozen here would make it a deployment of the customer site.
 * Empty on failure, like every other reader in this file, so the page still renders its form.
 */
const partnerTypeSchema = z.object({
  code: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  nameDe: z.string(),
});

export type PartnerType = z.infer<typeof partnerTypeSchema>;

export async function getPartnerTypes(): Promise<PartnerType[]> {
  return read('/partner-types', z.array(partnerTypeSchema), []);
}

const cityDetailSchema = z.object({
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  nameDe: z.string(),
  descriptionAr: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  descriptionDe: z.string().nullable(),
  categories: z.array(cityCategorySchema),
  tagsAr: z.array(z.string()),
  tagsEn: z.array(z.string()),
  tagsDe: z.array(z.string()),
  timezone: z.string(),
  latitude: z.string().nullable(),
  longitude: z.string().nullable(),
  country: z.object({
    code: z.string(),
    nameAr: z.string(),
    nameEn: z.string(),
    nameDe: z.string(),
  }),
  /*
    §5.4's hero band, hero first then by sort order.

    The API has served these since `city_images` was written and this schema dropped them on the
    floor — a strict object silently discarding a field is invisible, which is why the page could
    say «no image pipeline exists» while one did. Nothing here is defaulted: an empty array means
    the city genuinely has no photograph, and the page draws its gradient.
  */
  images: z
    .array(
      z.object({
        fileKey: z.string(),
        variantWidths: z.array(z.number()),
        width: z.number().nullable(),
        height: z.number().nullable(),
        alt: z.object({
          ar: z.string().nullable(),
          en: z.string().nullable(),
          de: z.string().nullable(),
        }),
        isHero: z.boolean(),
      }),
    )
    .default([]),
});

export type CityDetail = z.infer<typeof cityDetailSchema>;

/** Returns null for an unknown slug, so the page can render a proper 404. */
export async function getCity(slug: string): Promise<CityDetail | null> {
  return read(`/cities/${encodeURIComponent(slug)}`, cityDetailSchema.nullable(), null);
}

const propertyTypeSchema = z.object({
  code: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  nameDe: z.string(),
  glyph: z.string().nullable(),
  propertyCount: z.number(),
});

export type PropertyType = z.infer<typeof propertyTypeSchema>;

export async function getPropertyTypes(): Promise<PropertyType[]> {
  return read('/property-types', z.array(propertyTypeSchema), []);
}

const amenitySchema = z.object({
  code: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  nameDe: z.string(),
  category: z.string(),
  icon: z.string().nullable(),
  /**
   * How many published stays actually have it.
   *
   * The filter panel lists only amenities above zero. `unit_amenities` held zero rows on
   * 2026-09-02 while the catalogue listed twelve, so an unfiltered list would have given the
   * results page twelve checkboxes whose every outcome is «لا نتائج» — a control that reads as a
   * broken search rather than as an untagged catalogue.
   */
  propertyCount: z.number(),
});

export type Amenity = z.infer<typeof amenitySchema>;

export async function getAmenities(): Promise<Amenity[]> {
  return read('/amenities', z.array(amenitySchema), []);
}

/**
 * Operational values the storefront displays; see P-005.
 *
 * **Thirty seconds, not five minutes**, and it is the only reader here that differs.
 *
 * The rest of this file reads REFERENCE data — cities, amenities, currencies — which staff edit
 * rarely and which nobody watches a screen to confirm. These are RULES: the service fee's
 * visibility and the same-day cutoff hour both change what a customer is shown, and an operator
 * who flips a switch on الإعدادات goes and looks at the site. `SettingsService` already invalidates
 * its own 30-second cache on an admin write for exactly that reason; a further five minutes layered
 * on top here is a second cache that no write can invalidate, and it makes a working switch look
 * broken for long enough that somebody flips it back.
 *
 * Measured, not assumed: a fee-visibility change made in the console was still absent from the
 * customer's invoice minutes later, which is how this was found (2026-09-04). Thirty seconds
 * matches the layer underneath rather than inventing a third number, and the cost is one extra
 * request per half-minute against an endpoint whose own answer is already cached.
 */
export async function getPublicSettings(): Promise<Record<string, unknown>> {
  return read('/settings/public', z.record(z.string(), z.unknown()), {}, 30);
}

const currencyCatalogueSchema = z.object({
  currencies: z.array(z.object({ code: z.string(), symbol: z.string() })),
  rates: z.array(z.object({ base: z.string(), quote: z.string(), rate: z.string() })),
});

/**
 * The currencies a visitor may pick, and the rates that make conversion possible.
 *
 * Cached for the same five minutes as every other reference read. A rate is set by hand by staff
 * and changes at most daily, so a browse price five minutes stale is not a category of error — and
 * the alternative is one extra round trip on every page that prints a price.
 *
 * The empty fallback is load-bearing: with no rates, `convertForDisplay` finds no pair and every
 * amount renders in its own currency, which is exactly the behaviour the site had before this
 * existed. A reference endpoint blipping must not change what a price says.
 */
export async function getCurrencyCatalogue() {
  return read('/currencies', currencyCatalogueSchema, { currencies: [], rates: [] });
}
