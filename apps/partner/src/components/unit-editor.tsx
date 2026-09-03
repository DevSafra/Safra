'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import type { PartnerPropertyDetail } from '@/lib/api';
import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { t } from '@/lib/strings';

type Unit = PartnerPropertyDetail['units'][number];

/**
 * الوحدات — every unit on one screen, each saved on its own.
 *
 * ## Why this is not gated behind `isStructurallyEditable`
 *
 * A published listing cannot change its address, because SAFRA verified it (§8.1). A published
 * listing's PRICES and capacity can change at any time, and must: they are the partner's ongoing
 * responsibility under P-006, and a hotel that cannot raise a price without asking staff is a
 * hotel that stops using the platform. The two rules are genuinely different, and the screen says
 * so rather than leaving the reader to infer it from which controls are missing.
 *
 * ## Why each unit saves separately
 *
 * A partner adjusting one price should not have every other unit's fields sent with it. Saving the
 * whole set in one request means one validation failure rejects work that was already correct, and
 * makes the audit trail read as though six units changed when one did.
 *
 * ## What «موقوفة» does, and what it does not
 *
 * `isActive: false` takes the unit off sale entirely — it leaves search and cannot be booked —
 * while its existing bookings stand. It is NOT a way to close dates; that is the calendar, and the
 * note says so, because a partner who blocks a fortnight by deactivating a unit has also removed
 * it from every future month.
 */
export function UnitEditor({
  reference,
  units,
}: {
  readonly reference: string;
  readonly units: readonly Unit[];
}) {
  if (units.length === 0) {
    return <p className="text-[12.5px] text-faint">{t.editProperty.unitsEmpty}</p>;
  }

  return (
    <div className="grid gap-3">
      <p className="text-[11.5px] leading-relaxed text-faint">
        {t.editProperty.unitsNote}
      </p>

      {units.map((unit) => (
        <UnitRow key={unit.id} reference={reference} unit={unit} />
      ))}
    </div>
  );
}

function UnitRow({
  reference,
  unit,
}: {
  readonly reference: string;
  readonly unit: Unit;
}) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(
    null,
  );

  const [form, setForm] = useState({
    nameAr: unit.nameAr,
    unitLabel: unit.unitLabel ?? '',
    maxGuests: String(unit.maxGuests),
    bedrooms: String(unit.bedrooms),
    beds: String(unit.beds),
    bathrooms: String(unit.bathrooms),
    basePrice: unit.basePrice,
    minNights: String(unit.minNights),
    maxNights: unit.maxNights === null ? '' : String(unit.maxNights),
    isActive: unit.isActive,
  });

  const set = (key: keyof typeof form) => (value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage(null);
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();

    if (busy) return;

    /*
      Only what CHANGED. Sending every field on every save would rewrite values the partner never
      touched, and `maxNights` in particular is a three-way field — a number, `null` to clear it,
      or absent to leave it alone — which a blanket send collapses into "always set".
    */
    const patch: Record<string, unknown> = {};

    /*
      `null` when cleared, not `''`. The update contract types this as `string | null`, and null is
      what removes a number — an empty string would be a unit whose physical label is nothing, which
      the check-in list would then print as a blank cell rather than skip.
    */
    if (form.unitLabel.trim() !== (unit.unitLabel ?? '')) {
      patch['unitLabel'] = form.unitLabel.trim() || null;
    }
    if (form.nameAr.trim() !== unit.nameAr) {
      patch['name'] = { ar: form.nameAr.trim() };
    }

    const numbers: [keyof typeof form, string, number][] = [
      ['maxGuests', 'maxGuests', unit.maxGuests],
      ['bedrooms', 'bedrooms', unit.bedrooms],
      ['beds', 'beds', unit.beds],
      ['bathrooms', 'bathrooms', unit.bathrooms],
      ['minNights', 'minNights', unit.minNights],
    ];

    for (const [key, field, original] of numbers) {
      const value = Number(form[key]);

      if (Number.isFinite(value) && value !== original) patch[field] = value;
    }

    if (Number(form.basePrice) !== Number(unit.basePrice)) {
      patch['basePrice'] = Number(form.basePrice);
    }

    const maxNights = form.maxNights.trim() === '' ? null : Number(form.maxNights);

    if (maxNights !== unit.maxNights) patch['maxNights'] = maxNights;

    if (form.isActive !== unit.isActive) patch['isActive'] = form.isActive;

    if (Object.keys(patch).length === 0) {
      setMessage({ kind: 'ok', text: t.editProperty.unitSaved });
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/units/${unit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });

      if (!response.ok) {
        setMessage({
          kind: 'bad',
          text: refusalFor(await codeOfResponse(response)) ?? t.editProperty.unitFailed,
        });
        setBusy(false);
        return;
      }

      setMessage({ kind: 'ok', text: t.editProperty.unitSaved });
      setBusy(false);
      router.refresh();
    } catch {
      setMessage({ kind: 'bad', text: t.editProperty.unreachable });
      setBusy(false);
    }
  }

  return (
    <form
      className="grid gap-3 rounded-[14px] border border-line bg-card p-4"
      data-unit={unit.id}
      onSubmit={(event) => void save(event)}
    >
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

      <Field
        label={t.editProperty.unitName}
        value={form.nameAr}
        onChange={set('nameAr')}
        dir="rtl"
        id={`unit-name-${unit.id}`}
      />

      {/*
        «رقم الوحدة» — the physical identifier used at check-in, which `units.unit_label` has always
        carried and no screen has ever shown (Bashar, 2026-08-19).

        NO `dir` override. It had `dir="ltr"`, which sets the direction AND moves the start edge, so
        the label sat on the right and the value somebody had just typed sat on the far left with
        the caret there too. An input a person TYPES INTO follows the page (Bashar, 2026-08-19 — now
        a standing rule in `.claude/CLAUDE.md`). The digits are still a left-to-right RUN inside it,
        which the bidi algorithm handles without being told; isolation is for DISPLAYING a value on
        a line of Arabic, not for a field.
      */}
      <Field
        label={t.editProperty.unitLabel}
        value={form.unitLabel}
        onChange={set('unitLabel')}
        dir="rtl"
        id={`unit-label-${unit.id}`}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Number_
          label={t.editProperty.unitGuestsField}
          value={form.maxGuests}
          onChange={set('maxGuests')}
          id={`unit-guests-${unit.id}`}
          min={1}
        />
        <Number_
          label={t.editProperty.unitBedrooms}
          value={form.bedrooms}
          onChange={set('bedrooms')}
          id={`unit-bedrooms-${unit.id}`}
          min={0}
        />
        <Number_
          label={t.editProperty.unitBeds}
          value={form.beds}
          onChange={set('beds')}
          id={`unit-beds-${unit.id}`}
          min={1}
        />
        <Number_
          label={t.editProperty.unitBathrooms}
          value={form.bathrooms}
          onChange={set('bathrooms')}
          id={`unit-bathrooms-${unit.id}`}
          min={0}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Number_
          label={`${t.editProperty.unitPrice} (${unit.currencyCode})`}
          value={form.basePrice}
          onChange={set('basePrice')}
          id={`unit-price-${unit.id}`}
          min={0}
          step="0.01"
        />
        <Number_
          label={t.editProperty.unitMinNights}
          value={form.minNights}
          onChange={set('minNights')}
          id={`unit-min-${unit.id}`}
          min={1}
        />
        <Number_
          label={t.editProperty.unitMaxNights}
          value={form.maxNights}
          onChange={set('maxNights')}
          id={`unit-max-${unit.id}`}
          min={1}
        />
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(event) => set('isActive')(event.target.checked)}
          className="size-4 cursor-pointer"
        />
        <span className="text-[12px] text-muted">{t.editProperty.unitActive}</span>
      </label>

      {form.isActive ? null : (
        <p className="text-[11px] leading-relaxed text-warn">
          {t.editProperty.unitInactiveNote}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="min-h-10 cursor-pointer rounded-lg border border-gold px-4 py-1.5 text-[12px] font-bold text-gold-ink disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
        >
          {busy ? t.editProperty.unitSaving : t.editProperty.unitSave}
        </button>

        <Link
          href={`/properties/${reference}/calendar?unit=${unit.id}`}
          className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-[11.5px] text-muted lg:min-h-0 lg:py-1.5"
        >
          {t.editProperty.openUnitCalendar}
        </Link>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  dir,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly dir: 'rtl' | 'ltr';
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[12px] text-muted">{label}</span>
      <input
        id={id}
        dir={dir}
        value={value}
        maxLength={160}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text lg:min-h-0"
      />
    </label>
  );
}

/** `Number` is taken, and a numeric field wants `dir="ltr"` whatever the page direction is. */
function Number_({
  id,
  label,
  value,
  onChange,
  min,
  step,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly min: number;
  readonly step?: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[12px] text-muted">{label}</span>
      <input
        id={id}
        type="number"
        dir="ltr"
        min={min}
        {...(step ? { step } : {})}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text lg:min-h-0"
      />
    </label>
  );
}
