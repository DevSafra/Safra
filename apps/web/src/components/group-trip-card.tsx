import Link from 'next/link';

import { ltrIsolate } from '@safra/i18n';

import { OrnamentField } from '@/components/ornament';
import { formatMoney, localisedText } from '@/lib/localise';
import { imageUrl } from '@/lib/property';
import { hasFinished, nightsBetween, type GroupTrip } from '@/lib/group-trips';
import { readableDateWithYear } from '@/lib/readable-date';
import type { Locale } from '@/i18n/routing';

/**
 * One announced trip, on the جروبات list.
 *
 * ## The price carries its currency or it is not a price
 *
 * `formatMoney(priceFrom, currencyCode, …)` and nothing else. The pair is `null` together — the
 * database has a CHECK constraint saying so — and when it is absent the card says «السعر عند الطلب»
 * rather than printing a bare figure. «المبلغ 450» is not a smaller version of the right answer:
 * SYP and USD differ by four orders of magnitude.
 *
 * ## The photograph is the card's first line (Bashar, 2026-09-29)
 *
 * «I do not want Group Trips displayed as text-only content… I consider imagery an important part
 * of travel discovery and marketing.» So the band sits above the words, in the SAME 3:2 the
 * destination card uses — a trip and a city are the same kind of promise to a reader, and two
 * ratios side by side on one page reads as a mistake rather than a distinction.
 *
 * `width`/`height` come from the row, so the browser reserves the box before the bytes arrive. A
 * grid of cards that reflows as its photographs land is the layout shift the craft floor names,
 * and it is worst on exactly the slow connection this audience is on.
 *
 * ## A finished trip still appears, and says so
 *
 * Hiding past trips would empty the section between two announcements and lose the evidence that
 * SAFRA runs these at all. The badge is what keeps it honest, and the list orders upcoming first.
 */
export function GroupTripCard({
  trip,
  locale,
  labels,
  className = '',
}: {
  readonly trip: GroupTrip;
  readonly locale: Locale;
  readonly labels: {
    readonly priceFrom: (amount: string) => string;
    readonly priceOnRequest: string;
    readonly nights: (n: number) => string;
    readonly seats: (n: number) => string;
    readonly past: string;
  };
  /** The item's own sizing: the home page's slider fixes its width, the groups grid does not. */
  readonly className?: string;
}) {
  const title = localisedText(trip.title, locale);
  const summary = localisedText(trip.summary, locale);
  const city = localisedText(trip.city.name, locale);
  const nights = nightsBetween(trip.startsOn, trip.endsOn);
  const finished = hasFinished(trip.endsOn);

  return (
    <li className={className}>
      <Link
        href={`/${locale}/groups/${trip.slug}`}
        className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-card transition-colors hover:border-gold/40"
      >
        {/* 3:2, the ratio the destination card already uses — see the note above. */}
        <div className="relative aspect-[3/2] overflow-hidden bg-band">
          {trip.cover ? (
            <picture>
              <source srcSet={imageUrl(trip.cover, 400, 'avif')} type="image/avif" />
              <source srcSet={imageUrl(trip.cover, 400, 'webp')} type="image/webp" />
              <img
                src={imageUrl(trip.cover, 400, 'webp')}
                /*
                  Empty where staff have written none: the trip's title is the next element in the
                  reading order, so a screen reader that also announced the picture would hear the
                  trip twice. Where alt text exists it is used, because then it says something the
                  title does not. The rule `city-card.tsx` states, applied to the same shape.
                */
                alt={localisedText(trip.cover.alt, locale)}
                {...(trip.cover.width !== null && trip.cover.height !== null
                  ? { width: trip.cover.width, height: trip.cover.height }
                  : {})}
                className="size-full object-cover transition-transform duration-500 ease-out-strong group-hover:scale-[1.05]"
                loading="lazy"
              />
            </picture>
          ) : (
            /*
              The honest unfinished state, not a stock photograph. A trip nobody has illustrated
              looks deliberately plain rather than borrowing somebody else's beach.
            */
            <OrnamentField
              id={`ornament-trip-${trip.slug}`}
              className="text-gold-read opacity-30"
            />
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-13 text-sky">{city}</span>
            {finished ? (
              <span className="rounded-full border border-line px-2 py-0.5 text-12 text-faint">
                {labels.past}
              </span>
            ) : null}
          </div>

          <h3 className="font-display text-lg text-text group-hover:text-gold-read">
            {title}
          </h3>
          <p className="line-clamp-2 text-sm leading-relaxed text-muted">{summary}</p>

          <p className="mt-auto flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-2 text-13 text-faint">
            <span className="whitespace-nowrap">
              {readableDateWithYear(trip.startsOn, locale)}
            </span>
            {nights > 0 ? <span>{labels.nights(nights)}</span> : null}
            {trip.seats !== null ? <span>{labels.seats(trip.seats)}</span> : null}
          </p>

          <p className="text-14 font-bold text-gold-read">
            {trip.priceFrom && trip.currencyCode
              ? /* The VALUE isolated, never the sentence: «من $100» otherwise reads «من 100$». */
                labels.priceFrom(
                  ltrIsolate(formatMoney(trip.priceFrom, trip.currencyCode, locale)),
                )
              : labels.priceOnRequest}
          </p>
        </div>
      </Link>
    </li>
  );
}
