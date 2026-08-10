import Link from 'next/link';

import { getMyProfile, getPortfolioCalendar, sidebarBadges } from '@/lib/api';
import { DayLegend, MonthGrid } from '@/components/month-grid';
import { RangeEditor } from '@/components/range-editor';
import { Shell } from '@/components/shell';
import { amount, count, marketToday } from '@/lib/format';
import { fill, t } from '@/lib/strings';

/**
 * التقويمات — every unit's month on one screen, grouped under the property that owns it.
 *
 * Bashar, 2026-08-10: "a new page to manage all rooms … each room should have its own calendar".
 *
 * ## Why this is not the per-unit screen in a loop
 *
 * تقويم الإتاحة answers one unit at a time and makes the partner pick a property, then a unit, then
 * a month. Somebody closing a weekend across a hotel did that once per room. This screen is one
 * request for the whole page — the API expands a page of properties in two queries — and one range
 * editor per unit, so the actual task takes one visit.
 *
 * ## What lives in the URL, and what is clamped
 *
 * `?month=` and `?cursor=` own the view, so it is shareable and survives a reload. The month is
 * CLAMPED to a real `YYYY-MM` rather than trusted: the API answers an out-of-range month with a
 * 400, and an unclamped `?month=13` would turn a typo into an error page instead of a calendar —
 * the same reasoning the console's page and size clamps are written down for.
 *
 * `?date=` is how the dashboard hands over. A day on the dashboard's portfolio calendar links here,
 * and that date decides which month to open AND is marked in every unit's grid, so the reader lands
 * looking at the day they clicked rather than at the top of a month.
 */
export const dynamic = 'force-dynamic';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** `YYYY-MM` for the month a date falls in. */
function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The month to open when the URL names none — the one the BUSINESS is in.
 *
 * Derived from `marketToday()` rather than from a UTC date. Damascus is UTC+3, so for the last three
 * hours of every month the UTC month is still the previous one, and a partner opening the screen on
 * the 1st would be shown the month that just ended.
 */
function currentMonth(): string {
  return marketToday().slice(0, 7);
}

/** The month before or after, without rolling into an invalid one. */
function shift(month: string, by: number): string {
  const [year, index] = month.split('-').map(Number);

  return monthOf(new Date(Date.UTC(year ?? 1970, (index ?? 1) - 1 + by, 1)));
}

/** The first and last day of a `YYYY-MM`, for the range editor's bounds. */
function bounds(month: string): { first: string; last: string } {
  const [year, index] = month.split('-').map(Number);
  /* Day zero of the NEXT month is the last day of this one, so leap years need no special case. */
  const end = new Date(Date.UTC(year ?? 1970, index ?? 1, 0));

  return {
    first: `${month}-01`,
    last: `${month}-${String(end.getUTCDate()).padStart(2, '0')}`,
  };
}

/** A single query value, ignoring the repeated-parameter case rather than guessing at it. */
function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

export default async function CalendarsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;

  const highlight = DATE.test(one(query['date'])) ? one(query['date']) : undefined;

  /*
    A `?date=` from the dashboard implies its month, so the reader does not also have to carry a
    `?month=`. An explicit month still wins, which is what makes the arrows work from here on.
  */
  const requested = one(query['month']) || (highlight ? highlight.slice(0, 7) : '');
  const month = MONTH.test(requested) ? requested : currentMonth();
  const cursor = one(query['cursor']);

  const [profile, calendar] = await Promise.all([
    getMyProfile(),
    getPortfolioCalendar(month, cursor || undefined),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  const shell = (children: React.ReactNode) => (
    <Shell
      title={t.calendars.title}
      partnerName={name}
      active="calendars"
      badges={sidebarBadges(profile)}
    >
      <div className="grid gap-4">{children}</div>
    </Shell>
  );

  if (calendar === 'unauthenticated') {
    return shell(<p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>);
  }

  if (calendar === 'failed') {
    return shell(<p className="text-sm text-muted">{t.unitCalendar.unreachable}</p>);
  }

  const { first, last } = bounds(month);
  const today = marketToday();

  const [year, index] = month.split('-').map(Number);
  /*
    The month name comes from the CATALOGUE, not from `Intl`. `ar` returns the Gregorian months
    under their Levantine or their Egyptian names depending on the runtime's data, and the handoff
    uses the Levantine set — see the note on `months` in the catalogue. The year is a plain numeral:
    `count()` would group it into «2,026».
  */
  const heading = fill(t.calendars.monthOf, {
    month: t.months[(index ?? 1) - 1] ?? '',
    year: String(year ?? ''),
  });

  /** The month arrows keep the cursor, which addresses a PROPERTY and is month-independent. */
  const monthHref = (target: string) => {
    const next = new URLSearchParams({ month: target });

    if (cursor) next.set('cursor', cursor);

    return `/calendars?${next.toString()}`;
  };

  return shell(
    <>
      <p className="text-[12.5px] leading-relaxed text-faint">{t.calendars.intro}</p>

      <nav aria-label={t.unitCalendar.month} className="flex items-center gap-2">
        <Link
          href={monthHref(shift(month, -1))}
          aria-label={t.unitCalendar.previousMonth}
          className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-[12px] text-muted lg:min-h-0 lg:py-1.5"
        >
          <span aria-hidden="true">→</span>
        </Link>
        <span className="text-[13px] font-bold text-text">{heading}</span>
        <Link
          href={monthHref(shift(month, 1))}
          aria-label={t.unitCalendar.nextMonth}
          className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-[12px] text-muted lg:min-h-0 lg:py-1.5"
        >
          <span aria-hidden="true">←</span>
        </Link>
      </nav>

      <DayLegend />

      {calendar.properties.length === 0 ? (
        <p className="text-[12.5px] text-faint">{t.calendars.noProperties}</p>
      ) : null}

      {calendar.properties.map((property) => (
        <section
          key={property.reference}
          data-property={property.reference}
          className="grid gap-3.5 rounded-[15px] border border-[rgba(var(--goldA),0.14)] bg-card p-4"
        >
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[14.5px] font-extrabold text-gold">{property.nameAr}</h2>
            <span className="text-[11px] text-faint" dir="ltr">
              {property.reference}
            </span>
            <span className="ms-auto text-[11px] text-faint">
              {count(property.units.length)} {t.calendars.unitCount}
            </span>
          </header>

          {property.units.length === 0 ? (
            <p className="text-[12px] text-faint2">{t.calendars.noUnits}</p>
          ) : null}

          {property.units.map((unit) => (
            <article
              key={unit.unitId}
              data-unit={unit.unitId}
              className="grid gap-3 border-t border-line2 pt-3.5"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="text-[13px] font-bold text-text">{unit.nameAr}</h3>
                <span className="text-[11.5px] text-faint" dir="ltr">
                  {amount(unit.basePrice, unit.currencyCode)} {t.unitCalendar.perNight}
                </span>
                <span className="text-[11.5px] text-faint">
                  {t.unitCalendar.minNightsShort} {count(unit.minNights)}
                </span>
                {/*
                  An off-sale unit is listed rather than hidden — the API returns it deliberately —
                  so it has to SAY it is off sale. A greyed row with no explanation reads as a fault.
                */}
                {!unit.isActive ? (
                  <span className="rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[10.5px] text-warn">
                    {t.calendars.inactive}
                  </span>
                ) : null}
              </div>

              <MonthGrid
                days={unit.days}
                currencyCode={unit.currencyCode}
                caption={fill(t.calendars.gridCaption, {
                  unit: unit.nameAr,
                  month: heading,
                })}
                today={today}
                {...(highlight ? { highlight } : {})}
              />

              <RangeEditor unitId={unit.unitId} first={first} last={last} />
            </article>
          ))}
        </section>
      ))}

      {/*
        "Load more" rather than a page number: the partner app has no numbered-page bar, and the
        console's OFFSET exception is documented as the console's alone. A cursor is one indexed seek
        whatever the portfolio, and it carries the month so paging never drops the reader's place.

        A cursor only moves FORWARD, so the way back has to be offered explicitly. Without it the
        reader who pressed «عرض عقارات أخرى» is stuck: the month arrows carry the cursor, so even
        changing month keeps them on the same slice of the portfolio.
      */}
      {cursor || calendar.nextCursor ? (
        <nav aria-label={t.calendars.title} className="flex flex-wrap items-center gap-2">
          {cursor ? (
            <Link
              href={`/calendars?month=${month}`}
              className="inline-flex min-h-10 w-fit items-center rounded-lg border border-line px-4 text-[12.5px] text-muted lg:min-h-0 lg:py-2"
            >
              {t.calendars.firstPage}
            </Link>
          ) : null}

          {calendar.nextCursor ? (
            <Link
              href={`/calendars?month=${month}&cursor=${encodeURIComponent(calendar.nextCursor)}`}
              className="inline-flex min-h-10 w-fit items-center rounded-lg border border-line px-4 text-[12.5px] text-muted lg:min-h-0 lg:py-2"
            >
              {t.calendars.loadMore}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>,
  );
}
