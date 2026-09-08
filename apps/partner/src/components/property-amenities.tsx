'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { AmenityPicker } from '@/components/amenity-picker';
import type { OfferableAmenity } from '@/lib/api';
import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { t } from '@/lib/strings';

/**
 * مرافق العقار — what the BUILDING offers, saved on its own.
 *
 * ## Why this is not inside `PropertyEditor`
 *
 * That form is gated behind `isStructurallyEditable`, and rightly: a published listing cannot
 * change the address SAFRA verified. Facilities are not that. A pool closing for the winter or a
 * car park opening is an ongoing fact about the property, in the same class as the prices and
 * capacity `UnitEditor` deliberately leaves editable after publication — and a listing that cannot
 * correct them keeps promising a guest something that is no longer true.
 *
 * It was inconsistent as well as wrong: a room's amenities were already editable on a published
 * listing and the building's were not, which is the same claim at two levels answered two ways.
 *
 * ## Saved by itself
 *
 * A PATCH carrying only `amenityCodes`, so a partner ticking a facility does not resubmit the
 * address, and the audit row says facilities changed rather than that the property did.
 */
export function PropertyAmenities({
  reference,
  amenities,
  initial,
}: {
  readonly reference: string;
  readonly amenities: readonly OfferableAmenity[];
  readonly initial: readonly string[];
}) {
  const router = useRouter();
  const c = t.editProperty;

  const [selected, setSelected] = useState<readonly string[]>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(
    null,
  );

  /* A set: order is not a change, so ticking and unticking one box leaves the button quiet. */
  const dirty =
    selected.length !== initial.length ||
    selected.some((code) => !initial.includes(code));

  async function save(): Promise<void> {
    if (busy || !dirty) return;

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/properties/${reference}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amenityCodes: [...selected] }),
      });

      if (!response.ok) {
        setMessage({
          kind: 'bad',
          text: refusalFor(await codeOfResponse(response)) ?? c.amenitiesFailed,
        });

        return;
      }

      setMessage({ kind: 'ok', text: c.saved });
      router.refresh();
    } catch {
      setMessage({ kind: 'bad', text: c.amenitiesFailed });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-2.5">
      <h3 className="text-[14px] font-bold text-text">{c.propertyAmenitiesLabel}</h3>
      <p className="text-[13px] text-faint">{c.propertyAmenitiesHint}</p>

      <AmenityPicker
        amenities={amenities}
        selected={selected}
        onChange={(codes) => {
          setSelected(codes);
          setMessage(null);
        }}
        idPrefix="property-amenity"
      />

      {message ? (
        <p
          role="status"
          className={`text-[13px] font-semibold ${
            message.kind === 'ok' ? 'text-ok' : 'text-bad'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <span>
        <button
          type="button"
          data-property-amenities-save
          disabled={busy || !dirty}
          onClick={() => void save()}
          className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg btn-gold px-4 py-2 text-[14px] font-bold disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
        >
          {busy ? c.propertyAmenitiesSaving : c.propertyAmenitiesSave}
        </button>
      </span>
    </section>
  );
}
