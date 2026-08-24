'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { TRIP_ATTRIBUTES } from '@safra/contracts';

import type { PropertyFormReference } from '@/lib/api';
import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { t, tripAttribute } from '@/lib/strings';

/** §7.2: "اختر حتى 4" — the handoff's own ceiling, and the API's is ten. */
const MAX_ATTRIBUTES = 4;

/**
 * The §7.2 add-property form.
 *
 * ## What a partner cannot do here
 *
 * Publish. The schema has no `status` field and the service forces `draft`, so the only outcome of
 * this form is a listing awaiting SAFRA's review — which is what P-002 requires and what the note
 * under the submit button says. Two barriers, and this component is neither of them.
 *
 * ## The trip attributes are the SHARED vocabulary
 *
 * `TRIP_ATTRIBUTES` from `@safra/contracts` — the same list the public search, the filters and the
 * property page use. The handoff is explicit that it must not be forked, so this renders that list
 * rather than a copy, and a chip a partner picks is by construction one a customer can search for.
 *
 * ## The three image slots are absent, and the form says why
 *
 * An image is uploaded against a property that already exists (`POST /partner/properties/
 * :reference/images`), so there is nothing to attach one to while this form is open. Drawing three
 * dead boxes would be worse than the sentence explaining it.
 */
export function AddProperty({
  reference,
  verified,
}: {
  readonly reference: PropertyFormReference;
  /**
   * Whether SAFRA has verified this partner.
   *
   * Step 7 holds units, prices, dates and images until verification, and «حسابك قيد المراجعة»
   * says so — but this form asked for a price and a unit count regardless, and the API accepted
   * them: `initialUnits` rides along on `POST /partner/properties`, the one property route that
   * is deliberately NOT behind `@RequireVerifiedPartner()` because writing an address and a
   * description before verification is the point of the wait. So the portal promised a
   * restriction it then let the reader walk straight through (Bashar, 2026-08-21).
   *
   * The API refuses it now. This prop is the other half: a form that submits fields the server
   * will reject is a form that fails after being filled in, which is worse than one that does not
   * ask. Below, the three fields are not rendered and `initialUnits` is not sent.
   */
  readonly verified: boolean;
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  function toggle(attribute: string): void {
    setPicked((current) =>
      current.includes(attribute)
        ? current.filter((value) => value !== attribute)
        : [...current, attribute],
    );
  }

  async function submit(form: FormData) {
    if (busy) return;

    if (picked.length > MAX_ATTRIBUTES) {
      setError(t.properties.attributesTooMany);
      return;
    }

    setBusy(true);
    setError(null);

    const text = (name: string): string => {
      const value = form.get(name);
      return typeof value === 'string' ? value.trim() : '';
    };
    const number = (name: string): number => Number(text(name));

    try {
      const response = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          citySlug: text('citySlug'),
          propertyTypeCode: text('propertyTypeCode'),
          cancellationPolicyCode: text('cancellationPolicyCode'),
          /* Arabic only. The console and the customer site fall back to it. */
          name: { ar: text('name') },
          ...(text('description') ? { description: { ar: text('description') } } : {}),
          address: text('address'),
          /* Omitted entirely when blank, so the API stores null rather than an empty label. */
          ...(text('roomNumber') ? { roomNumber: text('roomNumber') } : {}),
          attributes: picked,
          /* Omitted entirely before verification — the API refuses the field, not the request. */
          ...(verified
            ? {
                initialUnits: {
                  count: number('unitCount'),
                  basePrice: number('basePrice'),
                  maxGuests: number('maxGuests'),
                },
              }
            : {}),
        }),
      });

      if (!response.ok) {
        setError(refusalFor(await codeOfResponse(response)) ?? t.properties.createFailed);
        setBusy(false);
        return;
      }

      router.refresh();
      setOpen(false);
      setPicked([]);
      setBusy(false);
    } catch {
      setError(t.properties.unreachable);
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        /* The handoff's gold CTA gradient, §9.3, used only for primary actions. */
        className="min-h-10 cursor-pointer rounded-lg bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-4 py-2 text-[13px] font-extrabold text-[#241A05] lg:min-h-0"
      >
        {t.properties.addOpen}
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-gold/40 bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-extrabold text-gold">{t.properties.addOpen}</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-10 cursor-pointer rounded-lg border border-line px-3 text-[12px] text-muted lg:min-h-0 lg:py-1.5"
        >
          {t.properties.addClose}
        </button>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(new FormData(event.currentTarget));
        }}
        className="grid gap-3"
      >
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-[12.5px] text-bad"
          >
            {error}
          </p>
        ) : null}

        {/* auto-fit, min 200px, gap 12px — §7.2, verbatim. */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
          <Field name="name" label={t.properties.fName} required />
          <Select
            name="propertyTypeCode"
            label={t.properties.fType}
            options={reference.propertyTypes.map((type) => ({
              value: type.code,
              label: type.nameAr,
            }))}
          />
          <Select
            name="citySlug"
            label={t.properties.fCity}
            options={reference.cities.map((city) => ({
              value: city.slug,
              label: city.nameAr,
            }))}
          />
          {verified ? (
            <>
              <Field
                name="basePrice"
                label={t.properties.fPrice}
                type="number"
                min={0}
                required
              />
              <Field
                name="unitCount"
                label={t.properties.fUnits}
                type="number"
                min={1}
                max={50}
                defaultValue="1"
                required
              />
              <Field
                name="maxGuests"
                label={t.properties.fGuests}
                type="number"
                min={1}
                max={50}
                defaultValue="2"
                required
              />
            </>
          ) : (
            /*
              `sm:col-span-2` so the sentence spans the grid rather than sitting in one column
              where the price field used to be — it explains an absence, and half a row reads as
              a field that failed to render.
            */
            <p className="rounded-lg border border-line bg-field p-3 text-xs text-muted sm:col-span-2">
              {t.properties.unitsAfterVerification}
            </p>
          )}
          <Select
            name="cancellationPolicyCode"
            label={t.properties.fPolicy}
            options={reference.policies.map((policy) => ({
              value: policy.code,
              label: policy.nameAr,
            }))}
          />
          {/*
            «رقم الغرفة/الوحدة» (Bashar, 2026-08-19). Optional, and free text rather than a number:
            real ones read `A-12` or `3ب` as often as `101`, and nothing sorts or sums it.
          */}
          <Field
            name="roomNumber"
            label={t.properties.fRoomNumber}
            maxLength={20}
            placeholder={t.properties.fRoomNumberHint}
          />
          <Field name="address" label={t.properties.fAddress} required />
        </div>

        <label className="grid gap-1">
          <span className="text-[11.5px] text-muted">{t.properties.fDescription}</span>
          <textarea
            name="description"
            rows={3}
            className="rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text"
          />
        </label>

        <fieldset className="grid gap-2">
          <legend className="text-[11.5px] leading-relaxed text-muted">
            {t.properties.attributesLabel}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {TRIP_ATTRIBUTES.map((attribute) => {
              const on = picked.includes(attribute);

              return (
                <button
                  key={attribute}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(attribute)}
                  className={`min-h-10 cursor-pointer rounded-full border px-3 text-[11px] font-semibold lg:min-h-0 lg:py-1 ${
                    on
                      ? 'border-gold bg-gold/15 text-gold'
                      : 'border-line text-muted hover:border-gold/40'
                  }`}
                >
                  {tripAttribute(attribute)}
                </button>
              );
            })}
          </div>
        </fieldset>

        <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[11.5px] leading-relaxed text-faint">
          {t.properties.imagesLater}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="min-h-10 cursor-pointer rounded-lg bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-4 py-2 text-[13px] font-extrabold text-[#241A05] disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
          >
            {busy ? t.properties.submitting : t.properties.submit}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-10 cursor-pointer rounded-lg border border-line px-4 py-2 text-[12.5px] text-muted lg:min-h-0"
          >
            {t.properties.cancelForm}
          </button>
        </div>

        {/* P-002, quoted. The reason nothing here publishes anything. */}
        <p className="text-[11.5px] text-faint">{t.properties.reviewNote}</p>
      </form>
    </div>
  );
}

function Field({
  name,
  label,
  type = 'text',
  required,
  min,
  max,
  maxLength,
  placeholder,
  defaultValue,
}: {
  readonly name: string;
  readonly label: string;
  readonly type?: string;
  readonly required?: boolean;
  readonly min?: number;
  readonly max?: number;
  /** Matches the contract's own cap, so the browser refuses before the API has to. */
  readonly maxLength?: number;
  readonly placeholder?: string;
  readonly defaultValue?: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[11.5px] text-muted">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        {...(min === undefined ? {} : { min })}
        {...(max === undefined ? {} : { max })}
        {...(maxLength === undefined ? {} : { maxLength })}
        {...(placeholder === undefined ? {} : { placeholder })}
        {...(defaultValue === undefined ? {} : { defaultValue })}
        className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text"
      />
    </label>
  );
}

function Select({
  name,
  label,
  options,
}: {
  readonly name: string;
  readonly label: string;
  readonly options: readonly { value: string; label: string }[];
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[11.5px] text-muted">{label}</span>
      <select
        name={name}
        required
        className="min-h-10 cursor-pointer rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text"
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
