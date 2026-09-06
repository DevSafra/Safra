import type { APIRequestContext } from '@playwright/test';

/**
 * A property's §13.2 reference, looked up from its SLUG.
 *
 * ## Why nothing may hard-code one
 *
 * `db:testbed` deletes its fixture listings and creates them again, and `properties.reference` is
 * generated on insert — so every reset renumbers them. On 2026-09-06 a reseed turned the hotel's
 * `PRO-598653` into `PRO-601709` and `qasr-al-sharq-malki`'s `PRO-363247` into `PRO-601708`, and
 * every spec that had written one down started opening «هذه الصفحة غير موجودة» against a console
 * that was working perfectly.
 *
 * That matters more for Stage 6 than for a single run: an unattended overnight suite reseeds to get
 * a clean fixture, which is precisely the act that invalidates the references. A slug is stable —
 * it is derived from the name and the seeder writes it verbatim — so the slug is the identity a
 * spec should hold, and the reference is looked up when a partner or console screen needs one.
 *
 * Reads the public property endpoint, which carries the reference already; no session needed.
 */
export async function propertyReference(
  request: APIRequestContext,
  slug: string,
): Promise<string> {
  const response = await request.get(
    `http://localhost:4000/api/v1/properties/${encodeURIComponent(slug)}`,
  );

  if (!response.ok()) {
    throw new Error(`No property for slug "${slug}" (${response.status()}).`);
  }

  const { reference } = (await response.json()) as { reference?: string };

  if (typeof reference !== 'string' || reference.length === 0) {
    throw new Error(`Property "${slug}" carries no reference.`);
  }

  return reference;
}
