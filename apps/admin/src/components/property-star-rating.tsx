'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { StarRating } from '@safra/ui';

import { Actions, SelectField } from '@/components/geo-form';
import { apiErrorOf, label, t } from '@/lib/strings';

/** The five values, written once — the same list the partner portal offers. */
const STAR_VALUES = [1, 2, 3, 4, 5] as const;

/**
 * Setting or correcting a listing's star classification from the console (Bashar, 2026-09-04).
 *
 * ## Why the console can write this at all, when it can write nothing else about a property
 *
 * The console approves and rejects listings; it deliberately cannot EDIT one, because §8.1 says
 * SAFRA verified the address, the photographs and the documents against each other and a console
 * that could rewrite an address would invalidate its own «موثّق» badge. None of that applies to a
 * single bounded number a reviewer checks against the partner's papers.
 *
 * It is required rather than convenient. 2,703 listings predate the field and **2,016 of them are
 * published**, which their partner may no longer edit — so without this control, «the Super Admin
 * must be able to see the star rating for every property, including properties already published»
 * would be an empty column for the entire existing catalogue, permanently. It is also the only
 * path for a hotel re-classified after it went live.
 *
 * ## The current value is DRAWN above the control
 *
 * A `<select>` alone would make the reviewer read a number and imagine the stars. The row above it
 * is what a customer will actually see, so «is this right» is answered by looking rather than by
 * translating — and after saving, the row updates, which is the confirmation that the write landed.
 */
export function PropertyStarRating({
  reference,
  starRating,
}: {
  readonly reference: string;
  /** Null on a listing that predates the field — a real state, not a missing value. */
  readonly starRating: number | null;
}) {
  const router = useRouter();
  const c = t.sections.properties;

  const [value, setValue] = useState(starRating === null ? '' : String(starRating));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (value === '') return;

    setBusy(true);
    setError(null);
    setSaved(false);

    try {
      const response = await fetch(
        `/api/properties/${encodeURIComponent(reference)}/star-rating`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ starRating: Number(value) }),
        },
      );

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      setSaved(true);
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-star-editor={reference} className="grid gap-3">
      <p className="text-[12px] leading-relaxed text-faint2">{c.starRatingHint}</p>

      {/*
        What the customer sees, drawn — or the words «بلا تصنيف» when there is nothing to draw.
        An empty space here would read as a rendering fault on 2,703 listings.
      */}
      {value === '' ? (
        <p className="text-[12.5px] text-faint">{c.starUnset}</p>
      ) : (
        <StarRating
          value={Number(value)}
          size="md"
          label={label(t.enums.starRating, value)}
        />
      )}

      <SelectField
        label={c.starRatingLabel}
        value={value}
        onChange={setValue}
        name="starRating"
      >
        {/*
          The blank option exists ONLY while the listing has no classification, and it is the
          current state rather than a choice. Offering it afterwards would let a reviewer put a
          listing back to «unclassified», which is a historical state and not a decision anybody
          should be able to make.
        */}
        {starRating === null ? <option value="">{c.starUnset}</option> : null}
        {STAR_VALUES.map((one) => (
          <option key={one} value={String(one)}>
            {label(t.enums.starRating, String(one))}
          </option>
        ))}
      </SelectField>

      <Actions
        busy={busy}
        ready={value !== '' && value !== String(starRating ?? '')}
        error={error}
        saveLabel={t.sections.geo.save}
        busyLabel={t.sections.geo.saving}
        cancelLabel={t.sections.geo.cancel}
        onSave={() => void save()}
        onClose={() => {
          setValue(starRating === null ? '' : String(starRating));
          setError(null);
          setSaved(false);
        }}
      />

      {saved ? (
        <p className="text-[11.5px] font-semibold text-ok">{c.starRatingSaved}</p>
      ) : null}
    </div>
  );
}
