import Link from 'next/link';

import { formatMoney, localisedText } from '@/lib/localise';
import { hasFinished, nightsBetween, type GroupTrip } from '@/lib/group-trips';
import { readableDate } from '@/lib/readable-date';
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
 * ## A finished trip still appears, and says so
 *
 * Hiding past trips would empty the section between two announcements and lose the evidence that
 * SAFRA runs these at all. The badge is what keeps it honest, and the list orders upcoming first.
 */
export function GroupTripCard({
  trip,
  locale,
  labels,
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
}) {
  const title = localisedText(trip.title, locale);
  const summary = localisedText(trip.summary, locale);
  const city = localisedText(trip.city.name, locale);
  const nights = nightsBetween(trip.startsOn, trip.endsOn);
  const finished = hasFinished(trip.endsOn);

  return (
    <li>
      <Link
        href={`/${locale}/groups/${trip.slug}`}
        className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-card transition-colors hover:border-gold/40"
      >
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
            <span>{readableDate(trip.startsOn, locale)}</span>
            {nights > 0 ? <span>{labels.nights(nights)}</span> : null}
            {trip.seats !== null ? <span>{labels.seats(trip.seats)}</span> : null}
          </p>

          <p className="text-14 font-bold text-gold-read">
            {trip.priceFrom && trip.currencyCode
              ? labels.priceFrom(formatMoney(trip.priceFrom, trip.currencyCode, locale))
              : labels.priceOnRequest}
          </p>
        </div>
      </Link>
    </li>
  );
}
