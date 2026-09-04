'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AmenityPicker } from '@/components/amenity-picker';
import type { OfferableAmenity } from '@/lib/api';
import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { t } from '@/lib/strings';

/**
 * Adding a unit to an EXISTING listing — the other step nobody could take (Bashar, 2026-09-04).
 *
 * ## Why 991 listings were unbookable
 *
 * A unit could only ever be created inline, as `initialUnits` on `POST /partner/properties`. A
 * listing that arrived without one — created before verification, or created by a partner who left
 * the optional block empty — had no route to gaining one: الوحدات printed «لا وحدات بعد.» and
 * offered nothing at all. **991 properties were in that state and 468 of them were published**:
 * live listings with no price, no bookable unit, and an owner with no way to fix it.
 *
 * `POST /partner/properties/:reference/units` has existed throughout, with ownership, the pricing
 * permission, currency validation, amenity resolution and an audit row. This is its caller.
 *
 * ## The form is the four fields that cannot be defaulted
 *
 * `unitCreateSchema` defaults bedrooms, beds, bathrooms and `minNights`, so asking for them here
 * would be asking a partner to confirm the values the contract already chose. Name, capacity, price
 * and currency have no sensible default — a unit is exactly those four things — and every one of
 * them is editable immediately afterwards in the row this creates. The same four the creation form
 * asks for, so the two screens teach the same shape.
 *
 * ## Collapsed until asked for
 *
 * On a listing that already has units this is a secondary action, and an always-open form of four
 * fields under a list of units reads as a fifth unit that failed to save. On a listing with NO
 * units the caller opens it by default, because there the form is the whole task.
 */
export function AddUnit({
  reference,
  currencyCode,
  amenities,
  defaultOpen = false,
}: {
  readonly reference: string;
  /** The currency the listing's other units price in, or the partner's own where there are none. */
  readonly currencyCode: string;
  /** What SAFRA still offers — read once by the page and passed down, not fetched per form. */
  readonly amenities: readonly OfferableAmenity[];
  readonly defaultOpen?: boolean;
}) {
  const router = useRouter();

  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(
    null,
  );
  const [form, setForm] = useState({ name: '', maxGuests: '2', basePrice: '' });
  const [amenityCodes, setAmenityCodes] = useState<string[]>([]);

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage(null);
  };

  const ready = form.name.trim() !== '' && form.basePrice.trim() !== '';

  async function add(event: React.FormEvent) {
    event.preventDefault();

    if (busy || !ready) return;

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/properties/${encodeURIComponent(reference)}/units`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            /* Arabic only, as the creation form sends it — the API fills en/de from ar. */
            name: { ar: form.name.trim() },
            maxGuests: Number(form.maxGuests),
            basePrice: Number(form.basePrice),
            currencyCode,
            amenityCodes,
          }),
        },
      );

      if (!response.ok) {
        setMessage({
          kind: 'bad',
          text:
            refusalFor(await codeOfResponse(response)) ?? t.editProperty.unitAddFailed,
        });
        setBusy(false);

        return;
      }

      setMessage({ kind: 'ok', text: t.editProperty.unitAdded });
      setForm({ name: '', maxGuests: '2', basePrice: '' });
      setAmenityCodes([]);
      setBusy(false);
      /* The new unit arrives as a row of its own, which is the confirmation that it landed. */
      router.refresh();
    } catch {
      setMessage({ kind: 'bad', text: t.editProperty.unreachable });
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-add-unit={reference}
        className="min-h-10 w-fit cursor-pointer rounded-lg border border-line px-4 py-1.5 text-[12px] font-semibold text-muted lg:min-h-0"
      >
        {t.editProperty.unitAdd}
      </button>
    );
  }

  return (
    <form
      data-add-unit={reference}
      onSubmit={(event) => void add(event)}
      className="grid gap-3 rounded-card border border-gold/40 bg-card p-4"
    >
      <h4 className="text-[12.5px] font-bold text-text">{t.editProperty.unitAddTitle}</h4>

      <p className="text-[11.5px] leading-relaxed text-faint">
        {t.editProperty.unitAddHint}
      </p>

      {message ? (
        <p
          role="alert"
          className={`rounded-lg border p-2.5 text-[12px] ${
            message.kind === 'ok'
              ? 'border-good/40 bg-good/10 text-good'
              : 'border-bad/40 bg-bad/10 text-bad'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {/*
        No `dir` override on the name: a field a person types into follows the page, which on this
        screen is RTL. The two numbers below use the same `Number_` shape the unit rows use, so one
        screen does not hold two answers to «what does a numeric field look like».
      */}
      <label className="grid gap-1">
        <span className="text-[12px] text-muted">{t.editProperty.unitName}</span>
        <input
          value={form.name}
          onChange={(event) => set('name')(event.target.value)}
          maxLength={160}
          required
          className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text lg:min-h-0"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1">
          <span className="text-[12px] text-muted">{t.editProperty.unitGuestsField}</span>
          <input
            type="number"
            dir="ltr"
            min={1}
            max={50}
            value={form.maxGuests}
            onChange={(event) => set('maxGuests')(event.target.value)}
            required
            className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text lg:min-h-0"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-[12px] text-muted">{t.editProperty.unitPrice}</span>
          <input
            type="number"
            dir="ltr"
            min={0}
            step="0.01"
            value={form.basePrice}
            onChange={(event) => set('basePrice')(event.target.value)}
            required
            className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text lg:min-h-0"
          />
        </label>

        {/*
          The currency is SHOWN, not chosen. It is the listing's own — a second currency among a
          property's units would price one room in dollars and the next in lira on the same card.
        */}
        <label className="grid gap-1">
          <span className="text-[12px] text-muted">{t.editProperty.unitCurrency}</span>
          <input
            value={currencyCode}
            readOnly
            dir="ltr"
            className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-faint lg:min-h-0"
          />
        </label>
      </div>

      <AmenityPicker
        amenities={amenities}
        selected={amenityCodes}
        onChange={setAmenityCodes}
        idPrefix={`new-${reference}`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy || !ready}
          className="min-h-10 cursor-pointer rounded-lg border border-gold px-4 py-1.5 text-[12px] font-bold text-gold disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
        >
          {busy ? t.editProperty.unitAddSaving : t.editProperty.unitAddSubmit}
        </button>

        {/* Cancel only where there is something to return to — see `defaultOpen`. */}
        {defaultOpen ? null : (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setMessage(null);
            }}
            className="min-h-10 cursor-pointer rounded-lg border border-line px-4 py-1.5 text-[12px] text-muted lg:min-h-0"
          >
            {t.dialog.cancel}
          </button>
        )}
      </div>
    </form>
  );
}
