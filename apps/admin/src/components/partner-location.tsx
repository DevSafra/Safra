'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { apiErrorOf, t } from '@/lib/strings';

/**
 * §8.1's «الموقع على الخريطة», captured while the partner is being onboarded.
 *
 * ## Why it exists at all
 *
 * `partners.latitude` and `partners.longitude` were in the schema from the start and **nothing
 * ever wrote them**. §8.1 lists the map location among the registration data a verifier checks, so
 * the field could only ever read «لم يُحدَّد» — a requirement that was present in the database, in
 * the SRS and on the partner record, and absent from every screen that could have filled it.
 *
 * ## Two numbers, not a map
 *
 * A draggable map means a third-party tile script on a staff screen, on a page that already
 * handles documents and a signed contract. Two fields and a link to check the pin is what the task
 * needs: somebody reads the coordinates off a phone standing at the property, or pastes them from
 * whatever map they already use.
 *
 * `inputMode="decimal"` so a phone offers the right keypad, and no `dir` — the page is RTL and a
 * coordinate is a Latin RUN inside it, which the bidi algorithm lays out correctly on its own.
 * `dir="ltr"` would move the field's start edge away from its label.
 */
export function PartnerLocation({
  reference,
  latitude,
  longitude,
}: {
  reference: string;
  latitude: string | null;
  longitude: string | null;
}) {
  const copy = t.sections.partnerLocation;
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();

        const form = new FormData(event.currentTarget);

        setBusy(true);
        setError(null);
        setSaved(false);

        void fetch(`/api/partner-onboarding/${encodeURIComponent(reference)}/location`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            latitude: form.get('latitude'),
            longitude: form.get('longitude'),
          }),
        })
          .then(async (response) => {
            if (!response.ok) {
              const payload: unknown = await response.json().catch(() => null);

              /*
                The CODE resolved into Arabic, never the body's English `message` — the console is
                Arabic-only and `apiErrorOf` is the shared helper that does this.
              */
              setError(apiErrorOf(payload));

              return;
            }

            setSaved(true);
            /* So the record above re-reads the coordinates it now has. */
            router.refresh();
          })
          .catch(() => setError(t.sections.panels.failed))
          .finally(() => setBusy(false));
      }}
    >
      <p className="text-[12.5px] text-muted">{copy.intro}</p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-[11px] text-faint">
          {copy.latitude}
          <input
            name="latitude"
            required
            inputMode="decimal"
            defaultValue={latitude ?? ''}
            placeholder="33.5138"
            disabled={busy}
            className="min-h-10 w-32 rounded-lg border border-line bg-field px-3 py-2 text-[13px] text-text disabled:cursor-not-allowed lg:min-h-0"
          />
        </label>

        <label className="grid gap-1 text-[11px] text-faint">
          {copy.longitude}
          <input
            name="longitude"
            required
            inputMode="decimal"
            defaultValue={longitude ?? ''}
            placeholder="36.2765"
            disabled={busy}
            className="min-h-10 w-32 rounded-lg border border-line bg-field px-3 py-2 text-[13px] text-text disabled:cursor-not-allowed lg:min-h-0"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="min-h-10 cursor-pointer rounded-lg border border-line px-4 text-[12.5px] text-text disabled:cursor-not-allowed lg:min-h-0"
        >
          {busy ? copy.saving : copy.save}
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-[12px] text-bad">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p role="status" className="text-[12px] text-ok">
          {copy.saved}
        </p>
      ) : null}
    </form>
  );
}
