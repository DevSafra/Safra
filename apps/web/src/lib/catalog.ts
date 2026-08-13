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
async function read<T>(path: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${API_URL}/api/v1${path}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 300 },
    });

    if (!response.ok) return fallback;

    const parsed = schema.safeParse(await response.json());
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

const citySchema = z.object({
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  nameDe: z.string(),
  countryCode: z.string(),
  categories: z.array(z.string()),
  propertyCount: z.number(),
});

export type City = z.infer<typeof citySchema>;

export async function getCities(): Promise<City[]> {
  return read('/cities', z.array(citySchema), []);
}

const cityDetailSchema = z.object({
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  nameDe: z.string(),
  descriptionAr: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  descriptionDe: z.string().nullable(),
  categories: z.array(z.string()),
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
});

export type Amenity = z.infer<typeof amenitySchema>;

export async function getAmenities(): Promise<Amenity[]> {
  return read('/amenities', z.array(amenitySchema), []);
}

/** Operational values the storefront displays; see P-005. */
export async function getPublicSettings(): Promise<Record<string, unknown>> {
  return read('/settings/public', z.record(z.string(), z.unknown()), {});
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
