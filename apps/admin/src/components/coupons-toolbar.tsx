'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { COUPON_TYPES, type CouponType } from '@safra/contracts';

import { t, apiErrorOf, label } from '@/lib/strings';
import { TableToolbar } from './table-toolbar';

/**
 * §9.3's «+ كوبون جديد», and the bar it sits in.
 *
 * ## Why this component draws the toolbar
 *
 * The trigger belongs in the bar and the panel belongs UNDER it at the table's full width, and the
 * two share one piece of state. Placed in the bar's `end` slot instead, the panel inherits an
 * `ms-auto` wrapper that sizes to its content and renders in a third of the row — the same lesson
 * بطاقات الهدايا learned yesterday.
 *
 * ## A coupon's code and value are set ONCE
 *
 * There is no edit form for either, and that is deliberate rather than unfinished. A code is what a
 * customer was told; the value is what past redemptions were priced against. A different offer is a
 * different coupon — the API refuses both too, so this is not the only guard.
 */
export function CouponsToolbar({
  action,
  query,
  size,
  placeholder,
  currencies,
}: {
  readonly action: string;
  readonly query: string | undefined;
  readonly size: number;
  readonly placeholder: string;
  readonly currencies: readonly string[];
}) {
  const router = useRouter();
  const c = t.sections.coupons;

  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [type, setType] = useState<CouponType>('campaign');
  const [valueKind, setValueKind] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState(currencies[0] ?? 'USD');
  const [maxDiscount, setMaxDiscount] = useState('');
  const [minBooking, setMinBooking] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [perCustomer, setPerCustomer] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
    Shape only. Every rule that decides whether a coupon is COHERENT — a percentage in range, a
    fixed value with a currency, an end after a start — is re-checked by the schema and the
    database. This stops the obvious typo costing a round trip; it is not the guard.
  */
  const percentOk =
    valueKind !== 'percent' || (Number(value) >= 1 && Number(value) <= 100);
  const ready =
    /^[A-Za-z0-9\s-]{4,40}$/.test(code.trim()) &&
    /^\d{1,10}(\.\d{1,3})?$/.test(value.trim()) &&
    Number(value) > 0 &&
    percentOk &&
    startsOn !== '' &&
    endsOn !== '' &&
    endsOn > startsOn &&
    !busy;

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          type,
          valueKind,
          value: value.trim(),
          /* A percentage has no currency; sending one would be refused by the contract. */
          ...(valueKind === 'fixed' ? { currency } : {}),
          ...(maxDiscount.trim() ? { maxDiscountAmount: maxDiscount.trim() } : {}),
          ...(minBooking.trim() ? { minBookingAmount: minBooking.trim() } : {}),
          startsOn,
          endsOn,
          ...(maxRedemptions.trim()
            ? { maxRedemptions: Number(maxRedemptions.trim()) }
            : {}),
          ...(perCustomer.trim()
            ? { maxRedemptionsPerCustomer: Number(perCustomer) }
            : {}),
        }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setError(apiErrorOf(payload));

        return;
      }

      setOpen(false);
      setCode('');
      setValue('');
      setMaxDiscount('');
      setMinBooking('');
      setStartsOn('');
      setEndsOn('');
      setMaxRedemptions('');
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  const field =
    'rounded-[9px] border border-line bg-card px-3 py-2 text-[12.5px] text-text';
  const labelled = 'grid gap-1.5 text-[11.5px] font-semibold text-muted';

  const panel = !open ? null : (
    <div className="grid w-full gap-3 rounded-[10px] border border-line bg-field p-3.5">
      <h3 className="text-[13px] font-bold text-text">{c.newTitle}</h3>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className={labelled}>
          {c.fCode}
          {/* No `dir` — a field follows the page's direction; the bidi algorithm lays out Latin. */}
          {/*
            The rule reads inside the LABEL, in parentheses (Bashar, 2026-08-27).

            It was a separate line under the field, which put it below the thing it constrains and
            gave this row a third line nothing else in the grid had. In the label it is read before
            the box is typed into, which is when it is useful.
          */}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={c.fCodePlaceholder}
            className={field}
          />
        </label>

        <label className={labelled}>
          {c.fType}
          <select
            value={type}
            onChange={(e) => setType(e.target.value as CouponType)}
            className={`cursor-pointer ${field}`}
          >
            {COUPON_TYPES.map((option) => (
              <option key={option} value={option}>
                {label(t.enums.couponType, option)}
              </option>
            ))}
          </select>
        </label>

        <label className={labelled}>
          {c.fValueKind}
          <select
            value={valueKind}
            onChange={(e) =>
              setValueKind(e.target.value === 'fixed' ? 'fixed' : 'percent')
            }
            className={`cursor-pointer ${field}`}
          >
            <option value="percent">{c.kindPercent}</option>
            <option value="fixed">{c.kindFixed}</option>
          </select>
        </label>

        <label className={labelled}>
          {c.fValue}
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            placeholder={valueKind === 'percent' ? '10' : '0.00'}
            className={field}
          />
        </label>

        {/* Only for a fixed value: a percentage has no currency to be in. */}
        {valueKind === 'fixed' ? (
          <label className={labelled}>
            {c.fCurrency}
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={`cursor-pointer ${field}`}
            >
              {currencies.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className={labelled}>
          {c.fMaxDiscount}
          <input
            value={maxDiscount}
            onChange={(e) => setMaxDiscount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className={field}
          />
        </label>

        <label className={labelled}>
          {c.fMinBooking}
          <input
            value={minBooking}
            onChange={(e) => setMinBooking(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className={field}
          />
        </label>

        <label className={labelled}>
          {c.fStarts}
          <input
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            className={field}
          />
        </label>

        <label className={labelled}>
          {c.fEnds}
          <input
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            className={field}
          />
        </label>

        <label className={labelled}>
          {c.fMaxRedemptions}
          <input
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(e.target.value)}
            inputMode="numeric"
            placeholder="∞"
            className={field}
          />
        </label>

        <label className={labelled}>
          {c.fPerCustomer}
          <input
            value={perCustomer}
            onChange={(e) => setPerCustomer(e.target.value)}
            inputMode="numeric"
            className={field}
          />
        </label>
      </div>

      {error ? <p className="text-[11.5px] font-semibold text-bad">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={() => void submit()}
          className="min-h-10 cursor-pointer rounded-lg border border-[rgba(var(--goldA),0.4)] px-4.5 py-2 text-xs font-bold text-gold transition-colors hover:bg-[rgba(var(--goldA),0.08)] disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
        >
          {busy ? t.table.working : c.submit}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="min-h-10 cursor-pointer rounded-lg border border-line px-4.5 py-2 text-xs font-bold text-muted lg:min-h-0"
        >
          {c.cancel}
        </button>
      </div>
    </div>
  );

  return (
    <TableToolbar
      action={action}
      query={query}
      size={size}
      placeholder={placeholder}
      end={
        panel === null ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-10 cursor-pointer rounded-[9px] border border-[rgba(var(--goldA),0.4)] px-4 py-1.5 text-[12.5px] font-extrabold text-gold transition-colors hover:bg-[rgba(var(--goldA),0.08)] lg:min-h-0"
          >
            {c.create}
          </button>
        ) : null
      }
      below={panel}
    />
  );
}
