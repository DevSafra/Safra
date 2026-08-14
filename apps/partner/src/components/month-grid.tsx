import type { UnitCalendarDay } from '@/lib/api';
import { amount, count } from '@/lib/format';
import { dayStatus, t } from '@/lib/strings';

/**
 * A month, aligned to the weekday it actually starts on.
 *
 * ## Why the alignment and the header are the point
 *
 * Both calendars used to draw a plain run of squares: day 1 in the first cell whatever weekday it
 * fell on, and no weekday header above them. That is a strip of numbers rather than a calendar, and
 * it withholds the one thing a partner asks a lodging calendar — which of these is a weekend. The
 * grid now offsets the first day into its real column and names the columns.
 *
 * ## The week starts on SATURDAY
 *
 * Not Monday and not Sunday: this is the week as it is read in Syria, and the calendar is Arabic
 * only. Getting this wrong does not look broken, it looks subtly wrong — every date sits one column
 * from where the reader expects it, which is worse than no header at all.
 *
 * ## The leading cells carry no `data-day`
 *
 * They are spacers, `aria-hidden`, and deliberately without the attribute the tests count. A month
 * has 28 to 31 days and `[data-day]` must keep meaning exactly that; giving the offset cells the
 * same attribute would make a March grid claim 34 days.
 */

/** JS `getUTCDay()`: 0 Sunday … 6 Saturday. */
const WEEK_STARTS_ON = 6;

/**
 * The seven column labels, from `Intl` rather than a catalogue.
 *
 * Weekday names are one of the documented i18n exceptions (`docs/i18n.md`) precisely because the
 * platform already ships a correct translation of them for every locale it will ever serve.
 *
 * Anchored to 1 August 2026, which is a Saturday. Any Saturday would do — it exists only to walk
 * seven consecutive days in the order the columns appear.
 */
const WEEKDAY_LABELS = Array.from({ length: 7 }, (_, column) =>
  new Intl.DateTimeFormat('ar', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, 7, 1 + column)),
  ),
);

/** Which column a date belongs in, on a Saturday-first week. */
function columnOf(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();

  return (day - WEEK_STARTS_ON + 7) % 7;
}

/** The tone each state is drawn in. One place, so the grid and the legend cannot disagree. */
export const DAY_TONES: Record<string, string> = {
  available: 'border-line bg-field text-muted',
  booked: 'border-gold/60 bg-gold/15 text-gold',
  closed: 'border-bad/40 bg-bad/10 text-bad',
  maintenance: 'border-warn/40 bg-warn/10 text-warn',
};

export function MonthGrid({
  days,
  currencyCode,
  caption,
  today,
  highlight,
}: {
  readonly days: readonly UnitCalendarDay[];
  readonly currencyCode: string;
  /** Names the grid for a screen reader, which otherwise meets 31 unlabelled numbers. */
  readonly caption: string;
  /** `YYYY-MM-DD`. Days before it are dimmed — a partner cannot act on a night already gone. */
  readonly today: string;
  /** `YYYY-MM-DD` to mark, when the reader arrived by clicking that day on the dashboard. */
  readonly highlight?: string | undefined;
}) {
  const first = days[0];
  const leading = first ? columnOf(first.date) : 0;

  return (
    /*
      Seven columns at every width, because a month grid with a different number of columns is not a
      month grid. It scrolls inside its own box rather than widening the page.
    */
    <div className="overflow-x-auto">
      <div className="min-w-[320px]">
        {/*
          The header is its own 7-column grid rather than seven more cells in the day grid. Both
          have equal columns and the same gap, so they align — and the days stay a real list
          instead of a run of siblings with headings mixed in.
        */}
        <ol
          aria-hidden
          className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] text-faint2"
        >
          {WEEKDAY_LABELS.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ol>

        <ul aria-label={caption} className="grid grid-cols-7 gap-1">
          {/* Spacers, so day one lands under its own weekday. No `data-day` — see above. */}
          {Array.from({ length: leading }, (_, index) => (
            <li key={`lead-${index}`} aria-hidden />
          ))}

          {days.map((day) => {
            const isPast = day.date < today;
            const isToday = day.date === today;

            return (
              <li
                key={day.date}
                /*
                  The date and the state as ATTRIBUTES, not only as text. A test that read the Arabic
                  label would be asserting the catalogue rather than the calendar, and would break on
                  a wording change that altered nothing about availability.
                */
                data-day={day.date}
                data-day-status={day.status}
                {...(isToday ? { 'data-day-today': 'true' } : {})}
                {...(day.date === highlight ? { 'data-day-highlight': 'true' } : {})}
                /*
                  No `id` here, deliberately.

                  It carried `id={`day-${date}`}` for fragment scrolling, which is right on a screen
                  with ONE grid and invalid on التقويمات, where four units draw the same month and
                  every id appeared four times. A duplicate id is not cosmetic: `#day-2026-08-22`
                  then addresses whichever cell the browser reaches first, and the anchor a reader
                  followed lands on an arbitrary room's square.

                  Namespacing it per unit would make the HTML valid and the ids unreachable — the
                  dashboard links by `?date=`, so nothing knows a unit id to build a fragment from.
                  The blue ring marks the day in every grid instead; auto-scrolling to it is not
                  implemented rather than half-implemented.
                */
                /*
                  `ring-inset` on both rings, and that is not a style choice.

                  A Tailwind ring is a box-shadow drawn OUTSIDE the element, and this grid sits in an
                  `overflow-x-auto` box so it can scroll on a phone. A cell in the first or last
                  column therefore has its ring clipped by that box — today's marker was missing its
                  left edge whenever today fell on الجمعة, which is one day in seven and looks like a
                  rendering fault rather than a design (Bashar, 2026-08-14).
                  
                  Inset draws it within the cell's own box, so it cannot be clipped, and it costs no
                  layout: unlike a thicker border it does not move the content by a pixel.
                */
                className={`rounded-lg border p-1.5 text-center ${
                  DAY_TONES[day.status] ?? DAY_TONES['available'] ?? ''
                } ${isPast ? 'opacity-45' : ''} ${
                  isToday ? 'ring-1 ring-gold/70 ring-inset' : ''
                } ${day.date === highlight ? 'ring-2 ring-sky ring-inset' : ''}`}
              >
                {/* The day number is a Latin numeral inside an Arabic page — its own `dir`. */}
                <span className="block text-[12px] font-bold" dir="ltr">
                  {count(Number(day.date.slice(-2)))}
                </span>
                <span className="block text-[9.5px] leading-tight">
                  {dayStatus(day.status)}
                </span>
                <span
                  className={`block text-[9px] leading-tight ${
                    day.isPriceOverridden ? 'font-bold' : 'opacity-70'
                  }`}
                  dir="ltr"
                >
                  {amount(day.price, currencyCode)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** The four states, drawn in the same tones the grid uses. */
export function DayLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-faint2">{t.unitCalendar.legend}</span>
      {['available', 'booked', 'closed', 'maintenance'].map((state) => (
        <span
          key={state}
          className={`rounded-full border px-2.5 py-0.5 text-[10.5px] ${DAY_TONES[state] ?? ''}`}
        >
          {dayStatus(state)}
        </span>
      ))}
    </div>
  );
}
