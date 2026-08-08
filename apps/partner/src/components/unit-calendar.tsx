'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { PartnerPropertyDetail, UnitCalendarDay } from '@/lib/api';
import { amount, count } from '@/lib/format';
import { dayStatus, t } from '@/lib/strings';

/**
 * تقويم الإتاحة — one unit's month, and the editor that changes a span of it.
 *
 * ## Why a range and not a day
 *
 * A partner closing a week clicks seven times or types two dates. The endpoint writes the span in
 * one transaction, so a connection dropped half way leaves the month either changed or unchanged,
 * never partly. Editing day-by-day over a browser connection is the version that leaves a
 * half-closed week nobody notices until a booking arrives on the day that stayed open.
 *
 * ## «محجوز» is shown but never offered
 *
 * A booked night is a fact written by the booking flow, not a state the partner chooses. The
 * select offers متاح, مغلق and صيانة — exactly what `partnerSettableStatusSchema` accepts — because
 * a partner who could write `booked` by hand could hold inventory back from سفرة while appearing
 * available (§8.4). The screen says what happens to booked nights inside a range rather than
 * letting the partner discover it.
 */
export function UnitCalendar({
  property,
  unitId,
  month,
  days,
}: {
  readonly property: PartnerPropertyDetail;
  readonly unitId: string;
  /** `YYYY-MM`, the month being displayed. Owned by the URL so the view is shareable. */
  readonly month: string;
  readonly days: readonly UnitCalendarDay[];
}) {
  const router = useRouter();

  const unit = property.units.find((candidate) => candidate.id === unitId);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(
    null,
  );

  const first = days[0]?.date ?? `${month}-01`;
  const last = days[days.length - 1]?.date ?? first;

  const [range, setRange] = useState({ from: first, to: first });
  const [status, setStatus] = useState('');
  const [price, setPrice] = useState('');
  const [minNights, setMinNights] = useState('');
  const [note, setNote] = useState('');

  async function apply(event: React.FormEvent) {
    event.preventDefault();

    if (busy) return;

    /*
      Only the fields the partner filled in. The contract requires at least one and treats an
      omitted field as "leave it alone" — distinct from `null`, which CLEARS an override. Sending
      every field on every submit would reset the nightly price to base whenever somebody only
      meant to close a week.
    */
    const body: Record<string, unknown> = { from: range.from, to: range.to };

    if (status) body['status'] = status;
    if (price === 'clear') body['price'] = null;
    else if (price) body['price'] = Number(price);
    if (minNights) body['minNights'] = Number(minNights);
    if (note.trim()) body['note'] = note.trim();

    if (Object.keys(body).length === 2) {
      setMessage({ kind: 'bad', text: t.unitCalendar.failed });
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/units/${unitId}/calendar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        setMessage({ kind: 'bad', text: t.unitCalendar.failed });
        setBusy(false);
        return;
      }

      setMessage({ kind: 'ok', text: t.unitCalendar.applied });
      setBusy(false);
      router.refresh();
    } catch {
      setMessage({ kind: 'bad', text: t.unitCalendar.unreachable });
      setBusy(false);
    }
  }

  if (!unit) return <p className="text-[12.5px] text-faint">{t.unitCalendar.noUnits}</p>;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[13px] font-bold text-text">{unit.nameAr}</p>
        <p className="text-[11.5px] text-faint" dir="ltr">
          {amount(unit.basePrice, unit.currencyCode)} {t.unitCalendar.perNight}
        </p>
        <p className="text-[11.5px] text-faint">
          {t.unitCalendar.minNightsShort} {count(unit.minNights)}
        </p>
      </div>

      <MonthGrid days={days} currencyCode={unit.currencyCode} />

      <Legend />

      <form
        className="grid gap-3 rounded-[14px] border border-line bg-card p-4"
        onSubmit={(event) => void apply(event)}
      >
        <p className="text-[13px] font-bold text-text">{t.unitCalendar.editorTitle}</p>

        {message ? (
          <p
            role="alert"
            className={`rounded-lg border p-3 text-[12.5px] ${
              message.kind === 'ok'
                ? 'border-good/40 bg-good/10 text-good'
                : 'border-bad/40 bg-bad/10 text-bad'
            }`}
          >
            {message.text}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-[12px] text-muted">{t.unitCalendar.from}</span>
            <input
              type="date"
              required
              value={range.from}
              min={first}
              max={last}
              onChange={(event) =>
                setRange((current) => ({ ...current, from: event.target.value }))
              }
              className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text lg:min-h-0"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[12px] text-muted">{t.unitCalendar.to}</span>
            <input
              type="date"
              required
              value={range.to}
              min={range.from}
              max={last}
              onChange={(event) =>
                setRange((current) => ({ ...current, to: event.target.value }))
              }
              className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text lg:min-h-0"
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1">
            <span className="text-[12px] text-muted">{t.unitCalendar.status}</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="min-h-10 cursor-pointer rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text lg:min-h-0"
            >
              <option value="">{t.unitCalendar.statusUnchanged}</option>
              {/* Exactly what the contract accepts — `booked` is deliberately not here. */}
              <option value="available">{dayStatus('available')}</option>
              <option value="closed">{dayStatus('closed')}</option>
              <option value="maintenance">{dayStatus('maintenance')}</option>
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-[12px] text-muted">{t.unitCalendar.price}</span>
            <input
              type="number"
              min={0}
              step="0.01"
              dir="ltr"
              value={price === 'clear' ? '' : price}
              placeholder={t.unitCalendar.priceUnchanged}
              onChange={(event) => setPrice(event.target.value)}
              className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text lg:min-h-0"
            />
            <button
              type="button"
              onClick={() => setPrice(price === 'clear' ? '' : 'clear')}
              aria-pressed={price === 'clear'}
              className={`min-h-10 w-fit cursor-pointer rounded-lg border px-2.5 py-1 text-[11px] lg:min-h-0 ${
                price === 'clear' ? 'border-gold text-gold' : 'border-line text-faint2'
              }`}
            >
              {t.unitCalendar.priceClear}
            </button>
          </label>

          <label className="grid gap-1">
            <span className="text-[12px] text-muted">{t.unitCalendar.minNights}</span>
            <input
              type="number"
              min={1}
              max={365}
              dir="ltr"
              value={minNights}
              onChange={(event) => setMinNights(event.target.value)}
              className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text lg:min-h-0"
            />
          </label>
        </div>

        <label className="grid gap-1">
          <span className="text-[12px] text-muted">{t.unitCalendar.note}</span>
          <input
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text lg:min-h-0"
          />
          <span className="text-[10.5px] text-faint2">{t.unitCalendar.noteHint}</span>
        </label>

        <p className="text-[11.5px] leading-relaxed text-faint">
          {t.unitCalendar.bookedWarning}
        </p>

        <button
          type="submit"
          disabled={busy}
          className="min-h-10 w-fit cursor-pointer rounded-lg bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-5 py-2 text-[13px] font-extrabold text-[#241A05] disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
        >
          {busy ? t.unitCalendar.applying : t.unitCalendar.apply}
        </button>
      </form>
    </div>
  );
}

/** The tone each state is drawn in. One place, so the grid and the legend cannot disagree. */
const TONES: Record<string, string> = {
  available: 'border-line bg-field text-muted',
  booked: 'border-gold/60 bg-gold/15 text-gold',
  closed: 'border-bad/40 bg-bad/10 text-bad',
  maintenance: 'border-warn/40 bg-warn/10 text-warn',
};

function MonthGrid({
  days,
  currencyCode,
}: {
  readonly days: readonly UnitCalendarDay[];
  readonly currencyCode: string;
}) {
  return (
    /*
      Seven columns at every width, because a month grid with a different number of columns is not
      a month grid. It scrolls inside its own box rather than widening the page.
    */
    <div className="overflow-x-auto">
      <ul className="grid min-w-[320px] grid-cols-7 gap-1">
        {days.map((day) => (
          <li
            key={day.date}
            /*
              The date and the state as ATTRIBUTES, not only as text. A test that read the Arabic
              label would be asserting the catalogue rather than the calendar, and would break on a
              wording change that altered nothing about availability.
            */
            data-day={day.date}
            data-day-status={day.status}
            className={`rounded-lg border p-1.5 text-center ${TONES[day.status] ?? TONES['available'] ?? ''}`}
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
        ))}
      </ul>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-faint2">{t.unitCalendar.legend}</span>
      {['available', 'booked', 'closed', 'maintenance'].map((state) => (
        <span
          key={state}
          className={`rounded-full border px-2.5 py-0.5 text-[10.5px] ${TONES[state] ?? ''}`}
        >
          {dayStatus(state)}
        </span>
      ))}
    </div>
  );
}
