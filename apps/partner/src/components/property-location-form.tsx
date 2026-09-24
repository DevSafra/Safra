'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { count } from '@/lib/format';
import { fill, t } from '@/lib/strings';

import {
  LocationPicker,
  guestRadiusMetres,
  type LocationPickerLandmark,
} from '@safra/ui';
import { basemapBase } from '@safra/session';

/**
 * Where the self-hosted basemap lives.
 *
 * Derived HERE rather than inside `LocationPicker`: Next inlines `process.env.NEXT_PUBLIC_*`
 * at build time and only compiles this app, so an env read inside the `tsc`-built shared
 * package would be `undefined` in the browser and the map would quietly not appear.
 */
const BASEMAP = basemapBase({
  NEXT_PUBLIC_BASEMAP_URL: process.env['NEXT_PUBLIC_BASEMAP_URL'],
  NEXT_PUBLIC_MEDIA_URL: process.env['NEXT_PUBLIC_MEDIA_URL'],
});

/**
 * Setting a location on a listing that is PUBLISHED and has never had one.
 *
 * ## Why this exists beside the locked panel
 *
 * §8.1 freezes a published listing's structural fields, and rightly: SAFRA verified the
 * address against the documents and the photographs, and letting it change afterwards would
 * leave the «موثّق» badge making a claim nobody checked.
 *
 * Coordinates were inside that freeze, and the result was measured — 67 of 2,017 published
 * listings had them. The guest-facing map, the distances and the «قريب من» filter were all
 * dark for the rest, and the only route to fixing one listing was a support ticket.
 *
 * The distinction that makes this safe is between SETTING and MOVING. A location that is
 * null contradicts nothing SAFRA checked: the address is unchanged and still verified, and
 * the partner is only saying where that address already is. Moving an existing pin is a claim
 * about a different place and stays refused — the API enforces both halves, and this form is
 * only rendered for the unplaced case.
 *
 * ## It is its own form, not a field in the locked one
 *
 * `PropertyEditor` submits every structural field it holds. Reusing it here would offer a
 * partner a form whose other controls the API will refuse — the «work is done and then
 * discarded» failure the service's own note warns about. This one sends two keys.
 */
export function PropertyLocationForm({
  reference,
  cityLatitude,
  landmarks,
  cityLongitude,
}: {
  readonly reference: string;
  readonly cityLatitude: string | null;
  /**
   * The city's landmarks, for the «ابدأ من مكان تعرفه» shortcuts.
   *
   * This form matters MORE for them than the draft editor does: its reader is being asked to place
   * a listing that has been live for months, and «قرب الجامع الأموي» is how that person describes
   * where it is. A city at zoom 12 is the grey rectangle that produced 3% coverage.
   */
  readonly landmarks: readonly LocationPickerLandmark[];
  readonly cityLongitude: string | null;
}) {
  const router = useRouter();
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(
    null,
  );

  const placed = latitude !== '' && longitude !== '';

  async function save() {
    if (!placed || busy) return;

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/properties/${reference}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude, longitude }),
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
      /*
        Refreshed so the panel disappears: once the listing has a location this form must not
        be offered again, and the server decides that. Re-rendering from stale props would
        leave a partner looking at a control whose next submit the API refuses.
      */
      router.refresh();
    } catch {
      setMessage({ kind: 'bad', text: t.editProperty.unreachable });
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-3 rounded-card border border-line bg-card p-4">
      <LocationPicker
        basemapUrl={BASEMAP}
        latitude={latitude}
        longitude={longitude}
        fallbackLatitude={cityLatitude}
        fallbackLongitude={cityLongitude}
        onChange={(next) => {
          setLatitude(next.latitude);
          setLongitude(next.longitude);
          setMessage(null);
        }}
        /*
          The circle matters MORE here than on the draft form.

          This panel is the only route the 97% of already-published listings have, and its reader
          is a partner being asked to add a location to something that has been live for months.
          «Why would I now publish where my building is» is the reasonable question, and the
          shaded area is the answer — shown rather than asserted.
        */
        guestArea
        landmarks={landmarks}
        copy={{
          heading: t.editProperty.locationHeading,
          help: t.editProperty.locationHelp,
          missing: t.editProperty.locationMissing,
          set: t.editProperty.locationSet,
          clear: t.editProperty.locationClear,
          coordinates: t.editProperty.locationCoordinates,
          unavailable: t.editProperty.locationUnavailable,
          guestArea: t.editProperty.locationGuestArea,
          /*
            The radius, as a NUMBER in the sentence. The circle alone is a few pixels at the
            zoom a city opens at, so the promise it makes was unreadable exactly when it
            mattered. Filled here rather than in the picker because `fill` and the Arabic
            digits belong to the app, and a shared component must not learn either.
          */
          guestAreaHelp: fill(t.editProperty.locationGuestAreaHelp, {
            metres: count(Math.round(guestRadiusMetres(Number(cityLatitude) || 33.5138))),
          }),
          startFrom: t.editProperty.locationStartFrom,
        }}
      />

      <button
        type="button"
        /*
          Wrapped, not passed. `onClick` expects a void return and `save` is async, so
          handing it over directly leaves a floating promise whose rejection nothing catches
          — `no-misused-promises` is right to refuse it.
        */
        onClick={() => {
          void save();
        }}
        disabled={!placed || busy}
        className="min-h-10 w-fit cursor-pointer rounded-lg bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-5 py-2 text-14 font-extrabold text-[#241A05] disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
      >
        {busy ? t.editProperty.saving : t.editProperty.save}
      </button>

      {message ? (
        <p className={`text-13 ${message.kind === 'ok' ? 'text-ok' : 'text-bad'}`}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
