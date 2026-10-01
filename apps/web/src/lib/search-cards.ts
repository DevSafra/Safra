import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@/i18n/routing';
import type { Amenity } from '@/lib/catalog';
import type { SearchResultItem } from '@/lib/api';
import { dynamicMessage } from '@/lib/dynamic-message';
import { formatMoney, localisedName, localisedText } from '@/lib/localise';
import { imageUrl } from '@/lib/property';

/**
 * One result card, ready to draw (Bashar, 2026-10-01).
 *
 * ## Why the server writes every word
 *
 * The first batch renders on the server and every later one is fetched as the reader scrolls, so
 * the same card is drawn in two places. Formatting it twice — once with server translations and
 * once in the browser — is two answers to «how does this price read in German», and the place
 * they would disagree is the twenty-first card, which nobody checks. So the server turns a result
 * into strings ONCE, here, and the browser only lays them out.
 *
 * It also keeps the image host out of client code: `imageUrl` reads the server's environment.
 */
export interface CardModel {
  key: string;
  slug: string;
  href: string;
  name: string;
  image: { avif: string; webp: string; alt: string } | null;
  starRating: number | null;
  starLabel: string | null;
  typeLine: string;
  /** «١٫٧ كم من وسط دمشق», or the landmark the search measured from. */
  distance: string | null;
  badges: string[];
  unitName: string | null;
  unitDetails: string | null;
  amenities: string[];
  freeCancellation: string | null;
  review: { score: string; word: string | null; count: string } | null;
  newListing: string | null;
  stayFor: string;
  nightly: string;
  perNight: string;
  total: string | null;
  includesFees: string;
  cta: string;
  saved: boolean;
  labels: { save: string; saved: string; failed: string };
}

/** The guest-score word for a 1-5 average — the same floors the filter offers. */
export function ratingWordKey(
  score: number,
): 'ratingExcellent' | 'ratingVeryGood' | 'ratingGood' | 'ratingPleasant' | null {
  if (score >= 4.5) return 'ratingExcellent';
  if (score >= 4) return 'ratingVeryGood';
  if (score >= 3.5) return 'ratingGood';
  if (score >= 3) return 'ratingPleasant';
  return null;
}

export async function toCardModels(
  items: readonly SearchResultItem[],
  context: {
    locale: Locale;
    /** The party and dates as a ready-made `?…`, built from PARSED values by the caller. */
    stay: string;
    adults: number;
    nearLandmarkName: string | undefined;
    amenities: readonly Amenity[];
    saved: ReadonlySet<string>;
  },
): Promise<CardModel[]> {
  const { locale } = context;
  const t = await getTranslations({ locale, namespace: 'search.results' });
  const tp = await getTranslations({ locale, namespace: 'property' });
  const tt = await getTranslations({ locale, namespace: 'propertyTypes' });
  const ts = await getTranslations({ locale, namespace: 'starRating' });
  const tsearch = await getTranslations({ locale, namespace: 'search' });
  const tm = await getTranslations({ locale, namespace: 'amenities' });

  const amenityName = new Map(context.amenities.map((one) => [one.code, one]));

  return items.map((item) => {
    const name = localisedName(item, locale);
    const city = localisedName(
      { nameAr: item.cityNameAr, nameEn: item.cityNameEn, nameDe: item.cityNameDe },
      locale,
    );
    const metres = (value: number) =>
      value < 1000
        ? tp('distanceM', { value: new Intl.NumberFormat(locale).format(value) })
        : tp('distanceKm', {
            value: new Intl.NumberFormat(locale, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            }).format(value / 1000),
          });

    /* The chosen landmark wins: it is what the reader asked about. */
    const distance =
      item.distanceMetres !== null && context.nearLandmarkName
        ? tsearch('resultDistance', {
            value: metres(item.distanceMetres),
            landmark: context.nearLandmarkName,
          })
        : item.cityCentreMetres !== null
          ? tp('fromCityCentre', { value: metres(item.cityCentreMetres), city })
          : null;

    const unit = item.unit;
    const unitDetails = unit
      ? [
          t('bedrooms', { count: unit.bedrooms }),
          unit.bedType === 'double'
            ? t('bedsDouble', { count: unit.beds })
            : t('bedsSingle', { count: unit.beds }),
          t('bathrooms', { count: unit.bathrooms }),
        ].join(' · ')
      : null;

    /*
      The cancellation promise, in the unit the reader plans in: days once it is a day or more,
      hours below that. Zero hours is free right up to arrival, which is its own sentence rather
      than «0 ساعة».
    */
    const hours = item.freeCancellationHours;
    const freeCancellation = !item.freeCancellation
      ? null
      : hours === null || hours === 0
        ? t('freeAnytime')
        : hours % 24 === 0
          ? t('freeUntilDays', { count: hours / 24 })
          : t('freeUntilHours', { count: hours });

    const score = item.rating === null ? null : Number(item.rating);
    const wordKey = score === null ? null : ratingWordKey(score);

    const nightly = formatMoney(item.nightlyFrom, item.currencyCode, locale);

    return {
      key: item.propertyReference,
      slug: item.slug,
      href: `/${locale}/property/${item.slug}${context.stay}`,
      name,
      image: item.cover
        ? {
            avif: imageUrl(item.cover, 600, 'avif'),
            webp: imageUrl(item.cover, 600, 'webp'),
            /* Empty where the partner wrote none: the NAME follows, and would be heard twice. */
            alt: localisedText(item.cover.alt, locale),
          }
        : null,
      starRating: item.starRating,
      starLabel: item.starRating ? ts('stars', { count: item.starRating }) : null,
      typeLine: `${dynamicMessage(tt, item.propertyTypeCode, item.propertyTypeCode)} · ${city}`,
      distance,
      badges: item.badges.map((badge) =>
        badge === 'safra_verified' ? tp('badgeVerified') : tp('badgeRecommends'),
      ),
      unitName: unit ? localisedName(unit, locale) : null,
      unitDetails,
      /* The catalogue's own name is the fallback, never the raw code. */
      amenities: item.amenityCodes.map((code) => {
        const known = amenityName.get(code);
        return dynamicMessage(tm, code, known ? localisedName(known, locale) : code);
      }),
      freeCancellation,
      review:
        score !== null && item.reviewsCount > 0
          ? {
              score: new Intl.NumberFormat(locale === 'ar' ? 'ar-SY' : locale, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
                numberingSystem: 'latn',
              }).format(score),
              word: wordKey ? t(wordKey) : null,
              count: t('reviewsCount', { count: item.reviewsCount }),
            }
          : null,
      newListing: item.reviewsCount === 0 ? t('noReviews') : null,
      stayFor: t('stayFor', { nights: item.nights, adults: context.adults }),
      nightly,
      perNight: tp('perNight'),
      /* Only when it says something the nightly line does not — see PropertyCard. */
      total:
        item.nights > 1
          ? `${formatMoney(item.stayTotal, item.currencyCode, locale)} ${tp('totalFor', { nights: item.nights })}`
          : null,
      includesFees: t('includesFees'),
      cta: t('cta'),
      saved: context.saved.has(item.slug),
      labels: {
        save: t('save', { name }),
        saved: t('saved', { name }),
        failed: t('saveFailed'),
      },
    };
  });
}

/**
 * One stay on the full map: its pill and its card in the list beside the map.
 *
 * Built FROM the card model rather than beside it, so a stay's price, score and stars read the same
 * on the map as in the list it was opened from; the only additions are the point and a smaller
 * photograph, because the map's cards are a third of the width of the list's.
 */
export interface MapStay extends Pick<
  CardModel,
  | 'key'
  | 'slug'
  | 'href'
  | 'name'
  | 'starRating'
  | 'starLabel'
  | 'typeLine'
  | 'freeCancellation'
  | 'review'
  | 'newListing'
  | 'nightly'
  | 'perNight'
  | 'saved'
  | 'labels'
> {
  image: { webp: string; alt: string } | null;
  latitude: string;
  longitude: string;
}

export async function toMapStays(
  items: readonly SearchResultItem[],
  context: Parameters<typeof toCardModels>[1],
): Promise<MapStay[]> {
  const placed = items.filter((item) => item.publicLatitude && item.publicLongitude);
  const cards = await toCardModels(placed, context);

  return cards.map((card, index) => {
    const item = placed[index];
    return {
      key: card.key,
      slug: card.slug,
      href: card.href,
      name: card.name,
      starRating: card.starRating,
      starLabel: card.starLabel,
      typeLine: card.typeLine,
      freeCancellation: card.freeCancellation,
      review: card.review,
      newListing: card.newListing,
      nightly: card.nightly,
      perNight: card.perNight,
      saved: card.saved,
      labels: card.labels,
      image:
        item?.cover && card.image
          ? { webp: imageUrl(item.cover, 320, 'webp'), alt: card.image.alt }
          : null,
      latitude: item?.publicLatitude ?? '',
      longitude: item?.publicLongitude ?? '',
    };
  });
}
