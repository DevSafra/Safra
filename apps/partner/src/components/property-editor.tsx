'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { PartnerPropertyDetail, PropertyFormReference } from '@/lib/api';
import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { STAR_VALUES } from '@/lib/stars';
import { t, tripAttribute } from '@/lib/strings';
import { TRIP_ATTRIBUTES, usesStarRating } from '@safra/contracts';

/**
 * تعديل العقار — the form, for a listing that may still be edited.
 *
 * ## What it does NOT send
 *
 * Only fields the partner actually changed. A PATCH built from every input would re-send the whole
 * record on every save, which turns "I fixed a typo in the address" into a write that also
 * overwrites the English description with whatever the form happened to hold — including an empty
 * string, if that language was never filled in. Comparing against the loaded value keeps a save
 * to the size of the edit.
 *
 * ## Arabic is required, the other two are not
 *
 * `translatedText` requires `ar` and leaves `en`/`de` optional, so a partner is never blocked on
 * writing German. An emptied optional language is sent as absent rather than as `''`, because the
 * contract's `.min(1)` refuses an empty string and the partner would get a validation error for
 * clearing a field they were told was optional.
 */
export function PropertyEditor({
  property,
  reference,
}: {
  readonly property: PartnerPropertyDetail;
  readonly reference: PropertyFormReference;
}) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(
    null,
  );

  const [form, setForm] = useState({
    nameAr: property.name.ar,
    nameEn: property.name.en ?? '',
    nameDe: property.name.de ?? '',
    descriptionAr: property.description.ar ?? '',
    descriptionEn: property.description.en ?? '',
    descriptionDe: property.description.de ?? '',
    address: property.address,
    roomNumber: property.roomNumber ?? '',
    citySlug: property.citySlug,
    propertyTypeCode: property.propertyTypeCode,
    starRating: property.starRating === null ? '' : String(property.starRating),
    cancellationPolicyCode: property.cancellationPolicyCode,
    latitude: property.latitude ?? '',
    longitude: property.longitude ?? '',
  });

  const [attributes, setAttributes] = useState<readonly string[]>(property.attributes);

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage(null);
  };

  /** The patch: what differs from what was loaded, and nothing else. */
  function changes(): Record<string, unknown> {
    const patch: Record<string, unknown> = {};

    const name = {
      ar: form.nameAr.trim(),
      ...(form.nameEn.trim() ? { en: form.nameEn.trim() } : {}),
      ...(form.nameDe.trim() ? { de: form.nameDe.trim() } : {}),
    };

    if (
      name.ar !== property.name.ar ||
      (form.nameEn.trim() || null) !== property.name.en ||
      (form.nameDe.trim() || null) !== property.name.de
    ) {
      patch['name'] = name;
    }

    const description = {
      ...(form.descriptionAr.trim() ? { ar: form.descriptionAr.trim() } : {}),
      ...(form.descriptionEn.trim() ? { en: form.descriptionEn.trim() } : {}),
      ...(form.descriptionDe.trim() ? { de: form.descriptionDe.trim() } : {}),
    };

    if (
      (form.descriptionAr.trim() || null) !== property.description.ar ||
      (form.descriptionEn.trim() || null) !== property.description.en ||
      (form.descriptionDe.trim() || null) !== property.description.de
    ) {
      patch['description'] = description;
    }

    if (form.address.trim() !== property.address) patch['address'] = form.address.trim();
    /*
      Sent whenever it CHANGED, including to empty — that is how a partner clears a room number they
      typed by mistake. `?? ''` on both sides so "was null, still blank" is not a change.
    */
    if (form.roomNumber.trim() !== (property.roomNumber ?? '')) {
      patch['roomNumber'] = form.roomNumber.trim();
    }
    if (form.citySlug !== property.citySlug) patch['citySlug'] = form.citySlug;
    if (form.propertyTypeCode !== property.propertyTypeCode) {
      patch['propertyTypeCode'] = form.propertyTypeCode;
    }
    /*
      Sent only when it CHANGED and only when it is a real value.

      Unlike a room number there is no "clear it" — the schema's 1-5 bound has no empty, and a
      listing that predates the field starts blank. So an untouched blank sends nothing, which
      leaves the null alone, and picking a value sends it.
    */
    if (
      usesStarRating(form.propertyTypeCode) &&
      form.starRating !== '' &&
      form.starRating !== String(property.starRating ?? '')
    ) {
      patch['starRating'] = Number(form.starRating);
    }
    if (form.cancellationPolicyCode !== property.cancellationPolicyCode) {
      patch['cancellationPolicyCode'] = form.cancellationPolicyCode;
    }
    if ((form.latitude.trim() || null) !== property.latitude && form.latitude.trim()) {
      patch['latitude'] = form.latitude.trim();
    }
    if ((form.longitude.trim() || null) !== property.longitude && form.longitude.trim()) {
      patch['longitude'] = form.longitude.trim();
    }

    const sameAttributes =
      attributes.length === property.attributes.length &&
      attributes.every((value) => property.attributes.includes(value));

    if (!sameAttributes) patch['attributes'] = [...attributes];

    return patch;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();

    if (busy) return;

    const patch = changes();

    /* Nothing changed: say so rather than sending an empty PATCH the API would reject. */
    if (Object.keys(patch).length === 0) {
      setMessage({ kind: 'ok', text: t.editProperty.saved });
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/properties/${property.reference}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });

      if (!response.ok) {
        setMessage({
          kind: 'bad',
          text: refusalFor(await codeOfResponse(response)) ?? t.editProperty.failed,
        });
        setBusy(false);
        return;
      }

      setMessage({ kind: 'ok', text: t.editProperty.saved });
      setBusy(false);
      router.refresh();
    } catch {
      setMessage({ kind: 'bad', text: t.editProperty.unreachable });
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={(event) => void save(event)}>
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
        <Field
          label={t.editProperty.nameAr}
          value={form.nameAr}
          onChange={set('nameAr')}
          required
          dir="rtl"
        />
        <Field
          label={t.editProperty.address}
          value={form.address}
          onChange={set('address')}
          required
          dir="rtl"
        />
        {/*
          Editable here because a room number typed wrongly at creation would otherwise be permanent.

          No `dir` override: an input a person types into follows the page — see the standing rule in
          `.claude/CLAUDE.md`. `dir="ltr"` put the caret and the value on the far left of a field
          whose own label sat on the right.
        */}
        <Field
          label={t.properties.fRoomNumber}
          value={form.roomNumber}
          onChange={set('roomNumber')}
          dir="rtl"
        />
        <Field
          label={t.editProperty.nameEn}
          value={form.nameEn}
          onChange={set('nameEn')}
          dir="ltr"
        />
        <Field
          label={t.editProperty.nameDe}
          value={form.nameDe}
          onChange={set('nameDe')}
          dir="ltr"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          label={t.editProperty.city}
          value={form.citySlug}
          onChange={set('citySlug')}
          options={reference.cities.map((city) => ({
            value: city.slug,
            label: city.nameAr,
          }))}
        />
        <Select
          label={t.editProperty.type}
          value={form.propertyTypeCode}
          onChange={set('propertyTypeCode')}
          options={reference.propertyTypes.map((type) => ({
            value: type.code,
            label: type.nameAr,
          }))}
        />
        {/*
          The classification, beside the type it classifies — the same order the creation form
          uses, so a partner editing a listing meets the fields where they left them.

          CONDITIONAL on the type, and on the type currently CHOSEN in this form rather than the
          one the listing was loaded with: a partner switching «فندق» to «فيلا» watches the field
          go, which is the whole rule made visible. (The service ignores a type change on update
          today, so this is the form being honest about the rule rather than about that gap.)

          The blank option exists ONLY for a listing that predates the field: it is the current
          state, and removing it would make the select silently claim a rating nobody declared the
          moment the form rendered. Once a value is chosen there is no way back to blank, which is
          correct — «not classified» is a historical state, not a choice.
        */}
        {usesStarRating(form.propertyTypeCode) ? (
          <Select
            label={t.properties.fStarRating}
            value={form.starRating}
            onChange={set('starRating')}
            options={[
              ...(property.starRating === null
                ? [{ value: '', label: t.properties.starUnset }]
                : []),
              ...STAR_VALUES.map((value) => ({
                value: String(value),
                label: t.properties.starOption[value] ?? String(value),
              })),
            ]}
          />
        ) : null}
        <Select
          label={t.editProperty.policy}
          value={form.cancellationPolicyCode}
          onChange={set('cancellationPolicyCode')}
          options={reference.policies.map((policy) => ({
            value: policy.code,
            label: policy.nameAr,
          }))}
        />
      </div>

      <Area
        label={t.editProperty.descriptionAr}
        value={form.descriptionAr}
        onChange={set('descriptionAr')}
        dir="rtl"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Area
          label={t.editProperty.descriptionEn}
          value={form.descriptionEn}
          onChange={set('descriptionEn')}
          dir="ltr"
        />
        <Area
          label={t.editProperty.descriptionDe}
          value={form.descriptionDe}
          onChange={set('descriptionDe')}
          dir="ltr"
        />
      </div>

      <fieldset className="grid gap-2">
        <legend className="pb-1 text-[12px] text-muted">
          {t.properties.attributesLabel}
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {TRIP_ATTRIBUTES.map((attribute) => {
            const on = attributes.includes(attribute);

            return (
              <button
                key={attribute}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setAttributes((current) =>
                    on
                      ? current.filter((value) => value !== attribute)
                      : [...current, attribute],
                  );
                  setMessage(null);
                }}
                className={`min-h-10 cursor-pointer rounded-full border px-3 py-1 text-[11.5px] lg:min-h-0 ${
                  on ? 'border-gold bg-gold/15 text-gold' : 'border-line text-muted'
                }`}
              >
                {tripAttribute(attribute)}
              </button>
            );
          })}
        </div>
        {attributes.length > 4 ? (
          <p className="text-[11.5px] text-bad">{t.properties.attributesTooMany}</p>
        ) : null}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* `dir="ltr"` on both: decimal degrees are a Latin number and RTL reorders the sign. */}
        <Field
          label={t.editProperty.latitude}
          value={form.latitude}
          onChange={set('latitude')}
          dir="ltr"
          hint={t.editProperty.coordinatesHint}
        />
        <Field
          label={t.editProperty.longitude}
          value={form.longitude}
          onChange={set('longitude')}
          dir="ltr"
        />
      </div>

      <button
        type="submit"
        disabled={busy || attributes.length > 4}
        className="min-h-10 w-fit cursor-pointer rounded-lg bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-5 py-2 text-[13px] font-extrabold text-[#241A05] disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
      >
        {busy ? t.editProperty.saving : t.editProperty.save}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  dir,
  required,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly dir: 'rtl' | 'ltr';
  readonly required?: boolean;
  readonly hint?: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[12px] text-muted">{label}</span>
      <input
        dir={dir}
        value={value}
        required={required}
        maxLength={300}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text lg:min-h-0"
      />
      {hint ? <span className="text-[10.5px] text-faint2">{hint}</span> : null}
    </label>
  );
}

function Area({
  label,
  value,
  onChange,
  dir,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly dir: 'rtl' | 'ltr';
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[12px] text-muted">{label}</span>
      <textarea
        dir={dir}
        value={value}
        rows={4}
        maxLength={4000}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly { value: string; label: string }[];
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[12px] text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-10 cursor-pointer rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text lg:min-h-0"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
