import Link from 'next/link';

import { getMyProfile, getPortfolioCalendar, sidebarBadges } from '@/lib/api';
import { DayLegend, MonthGrid } from '@/components/month-grid';
import { Ltr } from '@/components/ltr';
import { RangeEditor } from '@/components/range-editor';
import { Shell } from '@/components/shell';
import { amount, count, marketToday } from '@/lib/format';
import { fill, t } from '@/lib/strings';

/**
 * التقويمات — every unit's month on one screen, grouped under the property that owns it.
 *
 * Bashar, 2026-08-10: "a new page to manage all rooms … each room should have its own calendar".
 *
 * ## The shape of the screen
 *
 * Each عقار is a folder (Bashar, 2026-08-19). Everything expanded made two units 1600px of wall, so
 * a property opens on request, its range editors open on request, and its own search box narrows it
 * to one room number. There is no pager: the whole portfolio is fetched at the API's ceiling of ten
 * properties, because a «عرض عقارات أخرى» button was the thing being removed rather than the thing
 * being paged. A partner with more than ten properties would not see the rest — recorded honestly
 * here because the fix is lazy day-expansion, not a bigger number.
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
 * `?month=` owns the view, with `?unit=` and `?for=` when a property's search box is filled in, so
 * a filtered month is shareable and survives a reload. The month is
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
  /*
    «ابحث برقم الوحدة», and WHICH عقار it belongs to (Bashar, 2026-08-19).

    The box lives inside each property, so a search is scoped to one building and `for` names it.
    Both are trimmed and capped, so a pasted essay is a short search rather than an error page.

    Filtering happens HERE rather than in SQL, and that is sound BECAUSE it is scoped: the API
    expands every unit of every property it returns, so one property's units are all present and
    filtering them is a complete answer. The objection to page-side filtering — that it silently
    searches only what is on screen — is about searching ACROSS properties, which this does not do.
  */
  const search = one(query['unit']).trim().slice(0, 20);
  const searchIn = one(query['for']).trim().slice(0, 40);

  const [profile, calendar] = await Promise.all([
    getMyProfile(),
    getPortfolioCalendar(month),
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

  /** The arrows keep whatever search is running, so changing month keeps the reader's place. */
  const monthHref = (target: string) => {
    const next = new URLSearchParams({ month: target });

    if (search) next.set('unit', search);
    if (searchIn) next.set('for', searchIn);

    return `/calendars?${next.toString()}`;
  };

  /** Which units of a property to draw — all of them, unless its own search box is filled in. */
  const unitsOf = (property: (typeof calendar.properties)[number]) =>
    searchIn === property.reference && search
      ? property.units.filter((unit) =>
          (unit.unitLabel ?? '').toLowerCase().includes(search.toLowerCase()),
        )
      : property.units;

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

      {/*
        One FOLDER per عقار, not one wall of calendars (Bashar, 2026-08-19).

        Every unit used to render its month grid AND a full range editor, expanded — two units
        filled 1600px and a hotel was unreadable. A `<details>` per property lets a partner open the
        building they came for and leave the rest shut.

        The FIRST is open, and so is whichever one is being searched: a result the reader has to
        click to see is a result they will think they did not get.

        `<details>` rather than state: no JavaScript, keyboard-operable, announced as a disclosure,
        and the browser's own find-in-page can open it.
      */}
      {calendar.properties.map((property, index) => {
        const units = unitsOf(property);
        const searching = searchIn === property.reference && Boolean(search);

        return (
          <details
            key={property.reference}
            data-property={property.reference}
            open={index === 0 || searching}
            className="group rounded-[15px] border border-[rgba(var(--goldA),0.14)] bg-card p-4"
          >
            <summary className="flex list-none cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                aria-hidden
                className="text-[11px] text-faint transition-transform group-open:rotate-90"
              >
                ‹
              </span>
              <h2 className="text-[14.5px] font-extrabold text-gold">
                {property.nameAr}
              </h2>
              <span className="text-[11px] text-faint" dir="ltr">
                {property.reference}
              </span>
              <span className="ms-auto text-[11px] text-faint">
                {fill(t.calendars.unitsInside, { n: count(property.units.length) })}
              </span>
            </summary>

            <div className="grid gap-3.5 pt-3.5">
              {/*
                This عقار's own search, over its own rooms.

                A GET form so the query lives in the URL beside `month` — shareable, reload-safe and
                needs no JavaScript. `for` carries WHICH property the box belongs to, so two
                buildings' boxes cannot fight over one parameter, and `month` rides along because a
                search must never move the reader to a different month.

                The input is NOT `dir="ltr"`. It was, on the reasoning that a room number is a Latin
                run — but this is a place a person TYPES, on an Arabic-only dashboard, and a caret
                that starts on the wrong side is wrong however the value ends up rendering (Bashar,
                2026-08-19). The numbers themselves are still isolated where they are DISPLAYED.
              */}
              <form
                method="get"
                action="/calendars"
                role="search"
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="month" value={month} />
                <input type="hidden" name="for" value={property.reference} />
                {highlight ? <input type="hidden" name="date" value={highlight} /> : null}

                <label className="grid gap-1">
                  <span className="text-[11.5px] text-muted">
                    {t.calendars.searchLabel}
                  </span>
                  <input
                    name="unit"
                    defaultValue={searching ? search : ''}
                    maxLength={20}
                    placeholder={t.calendars.searchPlaceholder}
                    className="min-h-10 w-44 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text lg:min-h-0"
                  />
                </label>

                <button
                  type="submit"
                  className="min-h-10 cursor-pointer rounded-lg border border-gold px-4 text-[12.5px] text-gold transition-colors hover:bg-gold hover:text-bg lg:min-h-0 lg:py-2"
                >
                  {t.calendars.searchAction}
                </button>

                {searching ? (
                  <Link
                    href={`/calendars?month=${month}`}
                    className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-[12.5px] text-muted lg:min-h-0 lg:py-2"
                  >
                    {t.calendars.searchClear}
                  </Link>
                ) : null}
              </form>

              {property.units.length === 0 ? (
                <p className="text-[12px] text-faint2">{t.calendars.noUnits}</p>
              ) : null}

              {/* A search that matched nothing says so, rather than leaving the folder empty. */}
              {property.units.length > 0 && units.length === 0 ? (
                <p className="text-[12px] text-faint2">
                  {fill(t.calendars.searchNothing, { query: search })}
                </p>
              ) : null}

              {units.map((unit) => (
                <article
                  key={unit.unitId}
                  data-unit={unit.unitId}
                  className="grid gap-3 border-t border-line2 pt-3.5"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="text-[13px] font-bold text-text">
                      {unit.nameAr}
                      {/* The room this actually is, where the partner picks which room to manage. */}
                      {unit.unitLabel ? (
                        <span className="ms-2 whitespace-nowrap text-[11.5px] font-semibold text-muted">
                          {t.editProperty.unitLabel} <Ltr>{unit.unitLabel}</Ltr>
                        </span>
                      ) : null}
                    </h3>
                    <span className="text-[11.5px] text-faint" dir="ltr">
                      {amount(unit.basePrice, unit.currencyCode)}{' '}
                      {t.unitCalendar.perNight}
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

                  {/*
                The editor, folded away.

                A partner comes here to READ a month — "is the 14th free" — far more often than to
                change one, and a seven-field form under every unit made the calendar the thing you
                scrolled past. Closed, the grids sit one under the other and the page is scannable;
                open, it is exactly the editor it was.
              */}
                  <details className="rounded-lg border border-line2">
                    <summary className="min-h-10 list-none cursor-pointer px-3 py-2 text-[12px] text-muted lg:min-h-0">
                      {t.calendars.editRange}
                    </summary>
                    <div className="border-t border-line2 p-3">
                      <RangeEditor unitId={unit.unitId} first={first} last={last} />
                    </div>
                  </details>
                </article>
              ))}
            </div>
          </details>
        );
      })}
    </>,
  );
}
