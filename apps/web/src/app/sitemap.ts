import type { MetadataRoute } from 'next';

import { getCities, getLandmarks } from '@/lib/catalog';
import { getGroupTrips } from '@/lib/group-trips';
import { siteOrigin } from '@/lib/site-url';
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
 * GROUP TRIPS are here, and the difference from properties is the reason (Bashar, 2026-09-28).
 * There are a few dozen at most, every one is authored by staff rather than by 2,998 partners, and
 * `getGroupTrips` returns only what is PUBLISHED — so a trip archived this morning leaves this
 * document on the next hourly revalidation rather than lingering as an invitation to a 404. That
 * is the property the properties set does not have, and it is what earns them the entry.
 *
 * Trips that have already finished stay listed. Their page still answers 200 and still says
 * «انتهت», which is a true page about a real thing SAFRA ran; dropping it would be a claim that
 * the trip never happened.
 *
 * ## No coordinates, no prices, no availability
 *
 * A sitemap is a list of URLs and nothing else. Worth saying because a crawlable document is
 * exactly where bulk data gets published by accident — and `getLandmarks` DOES carry positions
 * since the partner's map picker needed them, so the guarantee here is about what is WRITTEN
 * rather than about what is in scope. Only `slug` is read below, and only to build a path.
 *
 * Those positions are landmarks' own, never a listing's: a mosque and an airport are published
 * facts, and no property coordinate is reachable from this file at all.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteOrigin();

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

  /*
    Published trips only — the API's own `WHERE`, not a filter here. A failed read yields `[]`, so
    a blip omits trips from one revalidation rather than failing the whole document: a sitemap that
    500s tells a crawler nothing, and one that is briefly short tells it almost everything.
  */
  const trips = await getGroupTrips();

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

    entries.push({
      url: `${base}/${locale}/about`,
      lastModified: now,
      changeFrequency: 'monthly',
      /* What SAFRA is and promises: found by somebody checking who they are about to pay. */
      priority: 0.5,
    });

    entries.push({
      url: `${base}/${locale}/groups`,
      lastModified: now,
      changeFrequency: 'weekly',
      /* A destination in its own right, like a city — somebody searches for «رحلات جماعية». */
      priority: 0.8,
    });

    for (const trip of trips) {
      entries.push({
        url: `${base}/${locale}/groups/${trip.slug}`,
        lastModified: now,
        changeFrequency: 'weekly',
        /*
          Just under the list. Unlike a landmark, a trip page IS the destination rather than a way
          in to one — so it does not sit as low as 0.6 — but the list is what ranks for the phrase.
        */
        priority: 0.7,
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
