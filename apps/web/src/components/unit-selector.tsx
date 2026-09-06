import Link from 'next/link';

import type { PropertyDetail } from '@/lib/property';

/**
 * The rooms a guest chooses between, and the point at which they choose one.
 *
 * ## What this replaces
 *
 * The page took `units[0]` — the cheapest — showed its amenities as though they were the
 * property's, and put one «احجز الآن» beside it. Every other unit was unreachable: a guest on a
 * two-room chalet could not book the larger room, and did not know it existed. Bashar asked for
 * the behaviour every large accommodation site has, which is that the rooms ARE the page.
 *
 * ## Each row carries its own booking link, and that is the selection
 *
 * No client state, no radio group, no "continue" button waiting on a choice. Pressing the action
 * on a row IS choosing that unit, which is how booking.com and its peers work, and it keeps this a
 * server component — the whole list renders in the first response with no hydration to wait for.
 * The link carries that unit's id, so what the guest picked is what checkout quotes.
 *
 * ## Priced per unit, with the fee already in
 *
 * `priceWithFee` is the page's own conversion, passed in rather than repeated, so a row here and
 * the summary in the sidebar can never disagree about what a night costs.
 *
 * ## Interchangeable rooms are ONE row, with a count
 *
 * A hotel with six identical doubles is six rows in `units` — one per physical room, because the
 * exclusion constraint keys on `unit_id` and a quantity column would trade the double-booking
 * guarantee for a counter that needs locking. That is right in the database and wrong on a page: a
 * guest met six indistinguishable «غرفة مزدوجة قياسية» rows and had to pick one at random.
 *
 * `roomTypeCode` is the schema's own answer, and until 2026-09-06 it was null on all 46,571 units
 * so nothing had ever grouped by it. Rooms sharing a code collapse to one row showing how many are
 * left; booking targets the cheapest of them, which is a specific physical room. A room with no
 * code is one of a kind — a villa, a farm — and stays a row of its own, which is exactly what the
 * column's own note says it means.
 *
 * ## One unit is not a list
 *
 * With a single unit the heading and the comparison furniture would be ceremony around a foregone
 * conclusion, so the row still renders — the guest still needs its occupancy, its terms and its
 * facilities — under a sentence that says there is one. Roughly 1,539 of the platform's published
 * properties have exactly one unit, so this is the common case, not the edge.
 */
export function UnitSelector({
  units,
  locale,
  propertySlug,
  stay,
  guests,
  priceWithFee,
  copy,
  amenityName,
}: {
  readonly units: PropertyDetail['units'];
  readonly locale: string;
  readonly propertySlug: string;
  readonly stay: { checkIn: string; checkOut: string };
  readonly guests: { adults: number; children: number; infants: number };
  readonly priceWithFee: (basePrice: string, currencyCode: string) => string;
  readonly copy: {
    title: string;
    note: string;
    one: string;
    book: string;
    layout: (u: { bedrooms: number; beds: number; bathrooms: number }) => string;
    guestsUpTo: (count: number) => string;
    nightsMin: (count: number) => string;
    nightsMax: (count: number) => string;
    available: string;
    cheapest: string;
    left: (count: number) => string;
    soldOut: string;
    amenitiesLabel: string;
    amenitiesNone: string;
    cancellation: string;
    cancellationName: string;
  };
  readonly amenityName: (code: string) => string;
}) {
  if (units.length === 0) return null;

  /*
    Grouped by type, in the order the API already sorted them (cheapest first), so the first of a
    group is the one a guest is offered and the group keeps its place in the price ordering.
  */
  const groups = new Map<string, PropertyDetail['units']>();

  for (const unit of units) {
    /* Null means one of a kind, so it groups with nothing — its own id keeps it alone. */
    const key = unit.roomTypeCode ?? `unit:${unit.id}`;

    groups.set(key, [...(groups.get(key) ?? []), unit]);
  }

  const rows = [...groups.values()];
  const many = rows.length > 1;

  /*
    A departure this unit will actually accept.

    The page's default window is built from the CHEAPEST unit's minimum, so on a hotel whose suite
    takes two nights and whose standard room takes one, the suite's link was born asking for a stay
    the suite forbids. The guest reached a priced checkout and the booking refused it — a control
    that appears to work and cannot complete.

    Only ever EXTENDS, and only when the chosen window is too short: a guest who picked their own
    dates keeps them wherever the unit allows them, and is told by the API rather than silently
    moved. The stated minimum sits on the row beside this, so the extension is never a surprise.
  */
  const departureFor = (unit: PropertyDetail['units'][number]): string => {
    const nights = Math.round(
      (Date.parse(`${stay.checkOut}T00:00:00Z`) -
        Date.parse(`${stay.checkIn}T00:00:00Z`)) /
        86_400_000,
    );

    if (nights >= unit.minNights) return stay.checkOut;

    const departure = new Date(`${stay.checkIn}T00:00:00Z`);

    departure.setUTCDate(departure.getUTCDate() + unit.minNights);

    return departure.toISOString().slice(0, 10);
  };

  return (
    <section id="units" className="scroll-mt-24">
      <h2 className="font-display text-xl text-text">{copy.title}</h2>
      <p className="mt-1 text-sm text-muted">{many ? copy.note : copy.one}</p>

      <ul className="mt-4 grid gap-3">
        {rows.map((group, index) => {
          /*
            The cheapest AVAILABLE room of the type — the API orders available first within a price,
            so a group's first row is one a guest can actually book. Falling back to the first when
            none is free keeps the type on the page, described but not offered.
          */
          const free = group.filter((one) => one.available);
          const unit = free[0] ?? group[0]!;
          const soldOut = free.length === 0;

          return (
            <li
              key={unit.id}
              /*
              A bordered row, not a card in a grid of cards. These are compared against each other
              down a single column — occupancy under occupancy, price under price — which a row does
              and a tile does not.
            */
              className="rounded-card border border-line bg-card p-4 sm:p-5"
            >
              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="font-display text-lg text-text">
                      {unit.name[locale as 'ar'] ?? unit.name.ar}
                    </h3>
                    {/* Named only when there is something to be cheapest THAN. */}
                    {many && index === 0 ? (
                      <span className="rounded-full border border-[rgba(var(--goldA),0.4)] px-2 py-0.5 text-[11px] font-semibold text-gold">
                        {copy.cheapest}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-1.5 text-sm text-muted">
                    {copy.guestsUpTo(unit.maxGuests)} · {copy.layout(unit)}
                  </p>

                  {/*
                    The count is of what is FREE, not of what exists.

                    It counted the group — every physical room of the type — so a hotel with one of
                    its two suites booked still promised «غرفتان متبقيتان» for exactly those dates.
                    The number a guest reads has to be the number they can have.
                  */}
                  {free.length > 1 ? (
                    <p className="mt-1 text-xs font-semibold text-gold">
                      {copy.left(free.length)}
                    </p>
                  ) : null}

                  {/*
                  The conditions a guest is agreeing to, beside the price rather than a page away.
                  Minimum stay is the one that turns a booking down at checkout, so it is stated
                  here where the choice is made.
                */}
                  <p className="mt-1 text-xs text-faint">
                    {copy.available} · {copy.nightsMin(unit.minNights)}
                    {unit.maxNights === null
                      ? ''
                      : ` · ${copy.nightsMax(unit.maxNights)}`}
                  </p>

                  <p className="mt-1 text-xs text-faint">
                    {copy.cancellation}: {copy.cancellationName}
                  </p>

                  <div className="mt-3">
                    <h4 className="text-[12px] font-semibold text-text2">
                      {copy.amenitiesLabel}
                    </h4>
                    {unit.amenityCodes.length > 0 ? (
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {unit.amenityCodes.map((code) => (
                          <li
                            key={code}
                            className="rounded-lg border border-line2 px-2.5 py-1 text-[12.5px] text-text2"
                          >
                            {amenityName(code)}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-[12.5px] text-faint">
                        {copy.amenitiesNone}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-stretch gap-2 sm:w-44 sm:items-end">
                  <p className="text-lg font-extrabold text-gold tabular-nums sm:text-end">
                    {priceWithFee(unit.basePrice, unit.currencyCode)}
                  </p>

                  {soldOut ? (
                    /*
                    Described, not offered. The type stays on the page — a guest who cannot
                    see the suite does not learn the hotel has one — but nothing here
                    pretends it can be booked, which is what a link to a taken room did.
                  */
                    <p className="text-center text-sm font-semibold text-warn sm:text-end">
                      {copy.soldOut}
                    </p>
                  ) : (
                    <Link
                      /*
                      THIS unit, with the guest's own dates and party — the same contract the sidebar
                      link uses, so a choice made here and a choice made there reach checkout the same
                      way. The party is capped at what the unit sleeps, because sending more guests
                      than it takes is a quote the API will refuse.
                    */
                      href={`/${locale}/checkout?property=${propertySlug}&unitId=${unit.id}&checkIn=${stay.checkIn}&checkOut=${departureFor(unit)}&adults=${Math.min(guests.adults, unit.maxGuests)}&children=${guests.children}&infants=${guests.infants}`}
                      className="block rounded-lg btn-gold px-4 py-2.5 text-center text-sm font-semibold transition-opacity hover:opacity-90"
                    >
                      {copy.book}
                    </Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
