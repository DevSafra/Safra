'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import type { OfferableAmenity, PartnerPropertyDetail } from '@/lib/api';
import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { AddUnit } from '@/components/add-unit';
import { AmenityPicker } from '@/components/amenity-picker';
import { t, plural } from '@/lib/strings';

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
  fallbackCurrency,
  amenities,
}: {
  readonly reference: string;
  readonly units: readonly Unit[];
  /** Used only when there are no units to take one from — the partner's own contract currency. */
  readonly fallbackCurrency: string;
  /** Read once by the page: every unit row and the add form offer the same catalogue. */
  readonly amenities: readonly OfferableAmenity[];
}) {
  /*
    An empty listing is not a dead end any more (Bashar, 2026-09-04).

    This returned the sentence «لا وحدات بعد.» and nothing else, on 991 listings — 468 of them
    published, so live and unbookable, with no route by which their owner could add the thing that
    makes a listing a listing. The form opens by default here because on this screen it IS the task.
  */
  if (units.length === 0) {
    return (
      <div className="grid gap-3">
        <p className="text-[12.5px] text-faint">{t.editProperty.unitsEmpty}</p>
        <AddUnit
          reference={reference}
          currencyCode={fallbackCurrency}
          amenities={amenities}
          defaultOpen
        />
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-[11.5px] leading-relaxed text-faint">
        {t.editProperty.unitsNote}
      </p>

      {/*
        Grouped by TYPE, not listed flat.

        A partner who answered «ستّ غرف» once got six identical rows and no sign the platform had
        understood them as one thing — the definition and the physical inventory looked the same,
        which is the distinction Bashar asked for. A type now has a heading saying how many rooms
        it holds, and the rooms sit under it, still individually priced and closable because each
        one really is a separate piece of inventory.

        A one-of-a-kind unit has no `roomTypeCode` and gets no heading: a villa announcing that it
        is «غرفة واحدة متطابقة» would be a control's worth of noise around a single row.
      */}
      {groupByType(units).map((group) => {
        const rooms = group.units.map((unit) => (
          <UnitRow
            key={unit.id}
            reference={reference}
            unit={unit}
            amenities={amenities}
          />
        ));

        /* One of a kind: no heading and nothing to fold. It IS the room. */
        if (group.units.length === 1) {
          return (
            <div key={group.key} className="grid gap-3">
              {rooms}
            </div>
          );
        }

        return (
          /*
            Folded shut.

            Saying «ستّ غرف» once used to be six passes through the add form; now it is one press,
            and the six full-height editors it produces are a page nobody can scan. So a TYPE reads
            as a line — its name, how many rooms it holds, and what that means to a guest — and the
            rooms open when a partner has business with them.

            `<details>` rather than component state: it works before hydration, and the disclosure
            triangle is an affordance every reader already knows.
          */
          <details
            key={group.key}
            data-unit-type={group.key}
            className="group rounded-card border border-line bg-card px-4 py-3"
          >
            {/*
              `list-none` and a rotating chevron, the same disclosure التقويمات already draws in
              this app. The browser's own marker is inconsistent across engines and invisible under
              some resets, and a folded group with no affordance is a row nobody knows they can
              open — which would have hidden six rooms behind nothing.
            */}
            <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span
                aria-hidden
                className="text-[11px] text-faint transition-transform group-open:rotate-90"
              >
                ‹
              </span>
              <span className="text-[12.5px] font-bold text-text">
                {group.units[0]?.nameAr}
              </span>
              <span className="text-[11.5px] font-semibold text-gold">
                {plural(t.editProperty.unitTypeCount, { count: group.units.length })}
              </span>
              <span className="text-[11px] text-faint">
                {t.editProperty.unitTypeHint}
              </span>
            </summary>

            <div className="mt-3 grid gap-3 border-t border-line pt-3">{rooms}</div>
          </details>
        );
      })}

      {/* The listing's own currency, so a second unit cannot price in a different one. */}
      <AddUnit
        reference={reference}
        currencyCode={units[0]?.currencyCode ?? fallbackCurrency}
        amenities={amenities}
      />
    </div>
  );
}

/**
 * Rooms gathered under the type they belong to, in the order they arrived.
 *
 * A null `roomTypeCode` means one of a kind, so it groups with NOTHING — keyed by the unit's own
 * id rather than by the absent code, or every villa on a listing would collapse into one group
 * called "null".
 */
function groupByType(units: readonly Unit[]): { key: string; units: readonly Unit[] }[] {
  const groups = new Map<string, Unit[]>();

  for (const unit of units) {
    /*
      Price and capacity are part of the identity, not just the code — the same key the property
      page and the booking allocation use. A partner who changed one room's price has stopped it
      being interchangeable with its siblings, and a heading still counting it among them would
      promise a guest a quantity the platform will not sell.
    */
    const key =
      unit.roomTypeCode === null
        ? `unit:${unit.id}`
        : `${unit.roomTypeCode}|${unit.basePrice}|${unit.maxGuests}`;

    groups.set(key, [...(groups.get(key) ?? []), unit]);
  }

  return [...groups].map(([key, grouped]) => ({ key, units: grouped }));
}

function UnitRow({
  reference,
  unit,
  amenities,
}: {
  readonly reference: string;
  readonly unit: Unit;
  readonly amenities: readonly OfferableAmenity[];
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

  /*
    Its own state rather than a key on `form`, because it is an ARRAY and the patch below compares
    scalars. Seeded from what the unit declares, which is why the projection had to start returning
    it — an editor that opened empty would have silently cleared a unit's amenities on any save.
  */
  const [amenityCodes, setAmenityCodes] = useState<string[]>([...unit.amenityCodes]);

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

    /*
      A SET comparison, order-insensitive. The API replaces the set wholesale, so sending it when
      nothing changed would rewrite links the partner never touched and make the audit trail read
      as though the amenities changed on every price edit.
    */
    const before = [...unit.amenityCodes].sort().join(',');

    if ([...amenityCodes].sort().join(',') !== before) {
      patch['amenityCodes'] = amenityCodes;
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
      className="grid gap-3 rounded-card border border-line bg-card p-4"
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

      <AmenityPicker
        amenities={amenities}
        selected={amenityCodes}
        onChange={(codes) => {
          setAmenityCodes(codes);
          setMessage(null);
        }}
        idPrefix={unit.id}
      />

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          /*
            Its own handle. The amenity picker above puts twelve more checkboxes inside this unit,
            so «the unit's checkbox» stopped identifying anything the day that shipped — and the
            spec that says so could not tell them apart.
          */
          data-unit-active={unit.id}
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
          className="min-h-10 cursor-pointer rounded-lg border border-gold px-4 py-1.5 text-[12px] font-bold text-gold disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
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

/**
 * `Number` is taken, and a numeric field's digits read left to right whatever the page does.
 *
 * Through `field-ltr` rather than the `dir` attribute. The comment here used to say the field
 * «wants `dir="ltr"` whatever the page direction is», which is the belief the standing rule exists
 * to correct: the attribute fixes the ORDER and breaks the PLACEMENT, moving the element's own
 * start edge to the left so the caret sits opposite its own label on an Arabic page. The class sets
 * the direction and takes the alignment from the document.
 */
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
        min={min}
        {...(step ? { step } : {})}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field-ltr min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text lg:min-h-0"
      />
    </label>
  );
}
