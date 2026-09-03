'use client';

import { useState } from 'react';
import Link from 'next/link';

import { BOOKING_VERIFICATION_MINUTES } from '@safra/contracts';

import { text } from '@/lib/form';
import { Ltr } from '@/components/admin-table';
import { apiErrorOf, fill, t } from '@/lib/strings';

/**
 * EC-010 tier 2 — proving a caller controls the contact details on a booking (SRS §16).
 *
 * ## The screen shows nothing about the booking until the code passes
 *
 * That is the whole point, and it is why this is a screen of its own rather than a control on the
 * detail page. An agent takes a call from somebody who cannot prove who they are; the flow is send
 * a code → the caller reads it back → only then is the booking opened. Before that this component
 * holds a reference and a masked destination, and nothing else — not the property, not the dates,
 * not the customer's name.
 *
 * ## What it does NOT change
 *
 * Ordinary staff access to a booking is unchanged: `BOOKING_READ_ALL` opens a booking by reference
 * and always did, and every read is audited. Sealing every booking behind a code would stop support
 * working. This seals the CALLER's path — the one where identity is in doubt — which is the case
 * EC-010 describes.
 */
export function BookingVerification() {
  const copy = t.sections.bookingVerify;

  const [reference, setReference] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [verified, setVerified] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, body?: unknown): Promise<unknown> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(path, {
        method: 'POST',
        ...(body === undefined
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
      });

      if (!response.ok) {
        /* A CODE resolved locally — the API's English sentence travels for logs only. */
        setError(apiErrorOf(await response.json().catch(() => null)));
        setBusy(false);

        return null;
      }

      setBusy(false);

      return await response.json().catch(() => null);
    } catch {
      setError(t.errors.unreachable);
      setBusy(false);

      return null;
    }
  }

  /*
    Trimmed, NOT upper-cased.

    `BKG-2026-000042` is all digits, so folding the case looks harmless — and `BKG-TEST-2bc2c0d7`
    is not, and folding it produced a 404 for a booking that exists. A reference is an identifier
    somebody reads out; guessing at its case is a guess, and the one place it was already being
    made is a bug wearing the same clothes.
  */
  const base = (suffix = ''): string =>
    `/api/bookings/${encodeURIComponent(reference.trim())}/verification${suffix}`;

  return (
    <section className="grid gap-4">
      <p className="text-[12.5px] text-muted">{copy.intro}</p>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {error}
        </p>
      ) : null}

      {/* ── Step one: the reference, and a code to the contact on it ── */}
      <form
        className="grid gap-2 rounded-lg border border-line bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();

          void call(base()).then((result) => {
            const sent = result as { sentTo?: string } | null;

            if (sent?.sentTo) {
              setSentTo(sent.sentTo);
              setVerified(null);
            }
          });
        }}
      >
        <label className="grid gap-1">
          <span className="text-[11px] text-faint">{copy.referenceLabel}</span>
          {/* No `dir`: a field a person types into follows the page (docs/i18n.md §9). */}
          <input
            name="reference"
            required
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            disabled={busy}
            className="min-h-10 w-64 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text disabled:cursor-not-allowed lg:min-h-0"
          />
          <span className="text-[10.5px] text-faint">{copy.referenceHint}</span>
        </label>

        <button
          type="submit"
          disabled={busy || reference.trim() === ''}
          className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg border border-gold/50 px-4 py-2 text-[12.5px] font-bold text-gold-ink hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
        >
          {busy ? copy.sending : copy.send}
        </button>
      </form>

      {/* ── Step two: the code the caller reads back ── */}
      {sentTo ? (
        <form
          className="grid gap-2 rounded-lg border border-gold/30 bg-gold/[0.06] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const code = text(new FormData(event.currentTarget), 'code').trim();

            void call(base('/confirm'), { code }).then((result) => {
              /*
                The reference the SERVER verified, never one rebuilt from the input.

                This used to case-shift the typed input, so «فتح الحجز» linked to
                `BKG-TEST-2BC2C0D7` for a booking called `BKG-TEST-2bc2c0d7` and every verified
                caller landed on a 404 (Bashar, 2026-08-25). The same upper-casing was removed from
                the input field earlier and survived here — which is why the value now comes off the
                response and there is nothing left to reshape.
              */
              const done = result as { reference?: string } | null;

              if (done?.reference) setVerified(done.reference);
            });
          }}
        >
          <p className="text-[12.5px] text-text">
            {fill(copy.sentTo, {
              destination: sentTo,
              minutes: String(BOOKING_VERIFICATION_MINUTES),
            })}
          </p>

          <label className="grid gap-1">
            <span className="text-[11px] text-faint">{copy.codeLabel}</span>
            {/*
              `inputMode="numeric"` and a six-digit pattern, so a phone shows the number pad and a
              mistyped letter is refused before a round trip — one of only three attempts.
            */}
            <input
              name="code"
              required
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              disabled={busy}
              className="min-h-10 w-32 rounded-lg border border-line bg-field px-3 py-2 text-center text-[14px] tracking-[0.3em] text-text disabled:cursor-not-allowed lg:min-h-0"
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg border border-gold/50 px-4 py-2 text-[12.5px] font-bold text-gold-ink hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
          >
            {busy ? copy.confirming : copy.confirm}
          </button>
        </form>
      ) : null}

      {/*
        Only now is there a way into the booking.

        Before this the screen holds a reference the AGENT typed and a masked destination — nothing
        the caller has been told, and nothing about the stay.
      */}
      {verified ? (
        <div className="grid gap-2 rounded-lg border border-ok/40 bg-ok/10 p-4">
          <p role="status" className="text-sm text-ok">
            {copy.verified}
          </p>
          <Link
            href={`/bookings/${encodeURIComponent(verified)}`}
            className="inline-flex min-h-10 w-fit items-center text-[12.5px] text-sky hover:underline lg:min-h-0"
          >
            <Ltr>{verified}</Ltr>
            <span className="ms-2">{copy.openBooking}</span>
          </Link>
        </div>
      ) : (
        <p className="text-[11px] text-faint">{copy.sealed}</p>
      )}
    </section>
  );
}
