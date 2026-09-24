import type { MetadataRoute } from 'next';

import { getCities, getLandmarks } from '@/lib/catalog';
import { routing } from '@/i18n/routing';

/**
 * The site's own map of itself, which did not exist — `/sitemap.xml` answered 404.
 *
 * ## What goes in, and what deliberately does not
 *
 * Cities and landmarks: both are small, stable, public reference sets, and both are pages a
 * person would actually search for («فنادق قرب الجامع الأموي» is the phrase this business runs
 * on). Every locale of each, because a German reader searching in German should land on the
 * German page rather than be redirected out of it.
 *
 * PROPERTIES are not here, and that is a decision rather than an omission. There are 2,700 of
 * them, the set turns over as partners publish and withdraw, and a sitemap that lists a listing
 * withdrawn yesterday is a crawler following a 404 on our own invitation. Listings are reached
 * through the city and landmark pages, which is the same route a person takes.
 *
 * ## No coordinates, no prices, no availability
 *
 * A sitemap is a list of URLs and nothing else. Worth saying because a crawlable document is
 * exactly where bulk data gets published by accident, and because the guarantee here is
 * structural rather than remembered: `getLandmarks` and `getCities` carry slugs and names, no
 * coordinate reaches this file at all, and the only listing data in the output is the absence
 * of any.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );

  const cities = await getCities();

  /*
    Landmarks are fetched PER CITY, because that is the only shape the endpoint offers — it is
    the vocabulary of a city-scoped filter. Sequential rather than parallel: this runs hourly at
    most and nine serial reference reads are cheaper to reason about than nine concurrent ones
    against a cache that would serve them anyway.
  */
  const landmarks: { citySlug: string; slug: string }[] = [];

  for (const city of cities) {
    for (const landmark of await getLandmarks(city.slug)) {
      landmarks.push({ citySlug: city.slug, slug: landmark.slug });
    }
  }

  const now = new Date();

  const entries: MetadataRoute.Sitemap = [];

  for (const locale of routing.locales) {
    entries.push({
      url: `${base}/${locale}`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1,
    });

    for (const city of cities) {
      entries.push({
        url: `${base}/${locale}/city/${city.slug}`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.8,
      });
    }

    for (const landmark of landmarks) {
      entries.push({
        url: `${base}/${locale}/landmark/${landmark.slug}`,
        lastModified: now,
        changeFrequency: 'weekly',
        /*
          Below a city's. A landmark page is a way IN to a city's stays rather than a
          destination in itself, and saying otherwise would compete with the page it leads to.
        */
        priority: 0.6,
      });
    }
  }

  return entries;
}
