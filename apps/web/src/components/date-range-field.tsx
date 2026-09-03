'use client';

import { useEffect, useMemo, useState } from 'react';

import { FieldPopover } from '@/components/field-popover';

/** `YYYY-MM-DD`, the only shape that crosses this component's boundary. */
type Iso = string;

/**
 * The two-month range calendar, as booking.com opens it (Bashar, 2026-09-02, with a screenshot).
 *
 * One trigger for both dates, opening two months side by side; the first press sets arrival, the
 * second sets departure, and a press before the current arrival starts again from there.
 *
 * ## Dates are strings the whole way through
 *
 * `YYYY-MM-DD` in, `YYYY-MM-DD` out, and the arithmetic is done on the three integers rather than
 * on a `Date`. A `new Date('2026-09-02')` is parsed as UTC midnight and then read back in the
 * reader's zone, so a visitor in Damascus asking for the 2nd submits the 1st for the eight hours
 * either side of it. The one `Date` used below is constructed with `Date.UTC` and read with UTC
 * getters, which is the same discipline `todayInDamascus()` follows on the server.
 *
 * ## Month and weekday names come from `Intl`
 *
 * `docs/i18n.md` names them as an explicit exception to "no user-facing text in code": there is no
 * value in translating «سبتمبر» by hand in three catalogues when the platform ships the same table.
 * `numberingSystem: 'latn'` because `globals.css` pins Western digits for Arabic — the rest of this
 * page prints `2,010` and a calendar in Arabic-Indic beside it would be two numeral systems on one
 * screen.
 *
 * ## What booking.com has that this does not
 *
 * Their panel carries a «ليس لدي تواريخ محددة» tab and the «خيارات تواريخ مرنة» pills (± 1, 2, 3, 7
 * days). Both submit a flexible-date search, and SAFRA's search contract takes an exact `checkIn`
 * and `checkOut` — §5.2 makes both mandatory. Drawing those controls would be drawing a filter the
 * API cannot answer.
 *
 * ## Without JavaScript
 *
 * The two native date inputs render until mount, with the same names and the same `min`, so the
 * form still submits from a browser that never ran a script.
 */
export function DateRangeField({
  labels,
  minDate,
  defaults,
  locale,
  children,
}: {
  labels: {
    dates: string;
    checkIn: string;
    checkOut: string;
    done: string;
    previousMonth: string;
    nextMonth: string;
  };
  minDate: Iso;
  defaults: { checkIn: Iso; checkOut: Iso };
  locale: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  /*
    BOTH dates are always set, and that is the invariant this control exists to keep.

    The native inputs it replaces carry `required`, which is what stopped an incomplete range
    reaching the API — §5.2 makes arrival and departure mandatory. A hidden input cannot be
    validated by the browser: `required` on one blocks submission with no message and, in Chrome,
    an «invalid form control is not focusable» error in the console. So the range is never allowed
    to be incomplete in the first place. Picking an arrival proposes one night; a later day extends
    it; a day at or before the arrival starts again there.
  */
  const [checkIn, setCheckIn] = useState<Iso>(defaults.checkIn);
  const [checkOut, setCheckOut] = useState<Iso>(defaults.checkOut);
  /*
    Whether the next press extends the range or starts a new one. booking.com's calendar behaves
    this way: the first press after opening is an arrival even when a range is already shown, which
    is what somebody means when they click a date on a calendar they just opened.
  */
  const [extending, setExtending] = useState(false);
  const [firstMonth, setFirstMonth] = useState(() => monthOf(defaults.checkIn));

  useEffect(() => setMounted(true), []);

  /*
    `ar-SY` rather than `ar`, matching `formatMoney` — a bare `ar` resolves to a default region
    whose month names are the Levantine ones on some engines and the Egyptian ones on others, and
    «أيلول» against «سبتمبر» is the kind of difference a Syrian reader notices immediately.
  */
  const intlLocale = locale === 'ar' ? 'ar-SY' : locale;

  const monthName = useMemo(
    () =>
      new Intl.DateTimeFormat(intlLocale, {
        month: 'long',
        year: 'numeric',
        numberingSystem: 'latn',
        timeZone: 'UTC',
      }),
    [intlLocale],
  );

  const dayName = useMemo(
    () => new Intl.DateTimeFormat(intlLocale, { weekday: 'short', timeZone: 'UTC' }),
    [intlLocale],
  );

  const readable = useMemo(
    () =>
      new Intl.DateTimeFormat(intlLocale, {
        day: 'numeric',
        month: 'short',
        numberingSystem: 'latn',
        timeZone: 'UTC',
      }),
    [intlLocale],
  );

  if (!mounted) return <>{children}</>;

  const summary = `${readable.format(utc(checkIn))} - ${readable.format(utc(checkOut))}`;

  const choose = (day: Iso) => {
    if (!extending || day <= checkIn) {
      setCheckIn(day);
      /* One night, so the range is valid the instant an arrival is chosen. */
      setCheckOut(nextDay(day));
      setExtending(true);
      return;
    }
    setCheckOut(day);
    setExtending(false);
  };

  return (
    <>
      <input type="hidden" name="checkIn" value={checkIn} />
      <input type="hidden" name="checkOut" value={checkOut} />

      <FieldPopover
        label={labels.dates}
        value={summary}
        doneLabel={labels.done}
        icon={<CalendarIcon />}
      >
        <div className="flex items-center justify-between gap-2 pb-1">
          <Nav
            label={labels.previousMonth}
            onClick={() => setFirstMonth(shiftMonth(firstMonth, -1))}
            disabled={firstMonth <= monthOf(minDate)}
          />
          <Nav
            label={labels.nextMonth}
            onClick={() => setFirstMonth(shiftMonth(firstMonth, 1))}
            forward
          />
        </div>

        {/* Two months from `sm`, one below it — a phone has no room for fourteen columns. */}
        <div className="flex gap-6 max-sm:flex-col">
          {[firstMonth, shiftMonth(firstMonth, 1)].map((month) => (
            <Month
              key={month}
              month={month}
              minDate={minDate}
              checkIn={checkIn}
              checkOut={checkOut}
              onChoose={choose}
              monthName={monthName}
              dayName={dayName}
            />
          ))}
        </div>
      </FieldPopover>
    </>
  );
}

/** One month grid. */
function Month({
  month,
  minDate,
  checkIn,
  checkOut,
  onChoose,
  monthName,
  dayName,
}: {
  month: string;
  minDate: Iso;
  checkIn: Iso;
  checkOut: Iso;
  onChoose: (day: Iso) => void;
  monthName: Intl.DateTimeFormat;
  dayName: Intl.DateTimeFormat;
}) {
  const [year, monthIndex] = month.split('-').map(Number) as [number, number];
  const first = Date.UTC(year, monthIndex - 1, 1);
  const days = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();

  /*
    The leading blanks. `getUTCDay()` is 0 for Sunday, and the columns below start on Sunday — which
    is the week Syria, Jordan and Lebanon use, and the one the reference calendar draws. A locale's
    own first day would be the more general answer and is a different feature; hard-coding Sunday
    here and saying so is better than reading `Intl.Locale.weekInfo`, which Safari did not ship.
  */
  const blanks = new Date(first).getUTCDay();

  return (
    <div className="min-w-0">
      <p className="pb-2 text-center text-[0.85rem] font-semibold text-text">
        {monthName.format(first)}
      </p>

      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: 7 }, (_, index) => (
          /* 2026-03-01 was a Sunday, so it seeds the seven column headings in order. */
          <span
            key={index}
            className="grid h-7 place-items-center text-[0.625rem] text-faint"
          >
            {dayName.format(Date.UTC(2026, 2, 1 + index))}
          </span>
        ))}

        {Array.from({ length: blanks }, (_, index) => (
          <span key={`blank-${index}`} aria-hidden />
        ))}

        {Array.from({ length: days }, (_, index) => {
          const day = iso(year, monthIndex, index + 1);
          const disabled = day < minDate;
          const isStart = day === checkIn;
          const isEnd = day === checkOut;
          const inRange = day > checkIn && day < checkOut;

          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              onClick={() => onChoose(day)}
              aria-pressed={isStart || isEnd}
              className={`grid h-8 w-full cursor-pointer place-items-center rounded-lg text-[0.75rem] tabular-nums transition-[background-color,color] duration-150 ease-out-strong disabled:cursor-not-allowed disabled:text-faint/50 ${
                isStart || isEnd
                  ? 'btn-gold font-bold'
                  : inRange
                    ? 'bg-band text-text'
                    : 'text-text not-disabled:hover:bg-field'
              }`}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Nav({
  label,
  onClick,
  disabled = false,
  forward = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  forward?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-8 cursor-pointer place-items-center rounded-lg border border-line text-text transition-[border-color] duration-200 ease-out-strong not-disabled:hover:border-gold/70 disabled:cursor-not-allowed disabled:text-faint"
    >
      <svg
        aria-hidden
        width="1em"
        height="1em"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        /* Mirrored under RTL so it points at the direction of travel, not at a fixed side. */
        className={forward ? 'rotate-180 rtl:rotate-0' : 'rtl:rotate-180'}
      >
        <path d="m14.5 5.5-7 6.5 7 6.5" />
      </svg>
    </button>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="1.15em"
      height="1.15em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.2" y="5" width="17.6" height="15.5" rx="2.2" />
      <path d="M3.2 9.8h17.6M8 3.2v3.4M16 3.2v3.4" />
    </svg>
  );
}

/* ── Date arithmetic, on strings ─────────────────────────────────────────── */

/** `2026-09` — the month a date belongs to, comparable as a string. */
function monthOf(date: Iso): string {
  return date.slice(0, 7);
}

function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split('-').map(Number) as [number, number];
  const shifted = new Date(Date.UTC(year, index - 1 + by, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function iso(year: number, month: number, day: number): Iso {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The next calendar day, over the month and year boundaries `Date.UTC` already handles. */
function nextDay(date: Iso): Iso {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return iso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/** A UTC timestamp for formatting only — never for comparison, which is done on the strings. */
function utc(date: Iso): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}
