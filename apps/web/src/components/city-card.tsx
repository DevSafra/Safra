import Link from 'next/link';

import { OrnamentField } from '@/components/ornament';
import type { City } from '@/lib/catalog';
import type { Locale } from '@/i18n/routing';
import { imageUrl } from '@/lib/property';
import { localisedName, localisedText } from '@/lib/localise';

/**
 * A destination.
 *
 * The prototype's card: a photograph, then the name with its category beside it and the country
 * and inventory count underneath. Where staff have uploaded no photograph the frame is filled with
 * the brand's ornament rather than left blank — a card that draws an empty box reads as a page
 * that failed to load, and three of the nine cities have no picture today.
 *
 * ## The title has no hover state of its own (Bashar, 2026-09-02)
 *
 * It underlined, which he asked to remove. Nothing replaces it and nothing needs to: the whole
 * card is one link, and hovering it already moves the border to gold and scales the photograph
 * inside its frame — two signals on the element the pointer is actually over. An underline on the
 * heading pointed at a smaller target than the one that responds.
 *
 * It is not recoloured either, and that is the measured half: `--color-gold` on the white card is
 * 3.55:1, and at 14–16px this heading needs 4.5:1, so a gold hover would have been a hover state
 * that fails contrast. The underline was what replaced it; now the border and the image carry it.
 */
export function CityCard({
  city,
  locale,
  stays,
}: {
  city: City;
  locale: Locale;
  stays: (key: 'cityStays', values: { count: number }) => string;
}) {
  const categories = city.categories
    .map((category) => localisedName(category, locale))
    .join(' · ');

  return (
    <Link
      href={`/${locale}/city/${encodeURIComponent(city.slug)}`}
      className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-card transition-[border-color] duration-200 ease-out-strong hover:border-gold/60"
    >
      {/*
        3:2, which is the ratio booking.com's carousel cards use — a destination photograph is a
        landscape, and 4:3 made the card taller than it was wide at every width.
      */}
      <div className="relative aspect-[3/2] overflow-hidden bg-band">
        {city.cover ? (
          <picture>
            <source srcSet={imageUrl(city.cover, 400, 'avif')} type="image/avif" />
            <source srcSet={imageUrl(city.cover, 400, 'webp')} type="image/webp" />
            <img
              src={imageUrl(city.cover, 400, 'webp')}
              /*
                Empty by design where staff have written none. The city's name is the next element
                in the reading order, so a screen reader that also announced the picture would hear
                the destination twice. Where alt text EXISTS it is used, because then it says
                something the name does not. This is the rule `geo.ts` states for the city page.
              */
              alt={localisedText(city.cover.alt, locale)}
              className="size-full object-cover transition-transform duration-500 ease-out-strong group-hover:scale-[1.05]"
              loading="lazy"
            />
          </picture>
        ) : (
          <OrnamentField
            id={`ornament-city-${city.slug}`}
            className="text-gold-read opacity-30"
          />
        )}
      </div>

      {/*
        The name on its own line, and the category beside the count under it.

        The prototype sets the category as a pill opposite the name, which works at its card width
        and not at ours: five across a 1152px container is a 208px card, and «صحراوية · تاريخية»
        in a pill next to «البتراء» left the name two characters of room. Below it, the pill has
        the full width and the row reads as one line of facts about the place.
      */}
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-17 font-bold text-text sm:text-20">
          {localisedName(city, locale)}
        </h3>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {categories ? (
            <span className="rounded-full border border-gold/35 bg-gold/10 px-2 py-0.5 text-13 text-gold-read">
              {categories}
            </span>
          ) : null}
          {/*
            The country code is gone (Bashar, 2026-09-03). «SY» beside «دمشق» told an Arabic reader
            nothing they did not already know, in Latin letters, on a card whose whole job is the
            place — and it read as a form field rather than as a fact about a city.
          */}
          {city.propertyCount > 0 ? (
            <span className="text-14 text-muted">
              {stays('cityStays', { count: city.propertyCount })}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
