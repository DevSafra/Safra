'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { BOOKING_CANCEL_REASON_MIN } from '@safra/contracts';

import { text } from '@/lib/form';
import { apiErrorOf, t } from '@/lib/strings';

/**
 * The two things a staff actor can DO to a booking from §9.4.
 *
 * ## Both endpoints already existed and neither had a caller
 *
 * `POST /bookings/:reference/cancel` has carried the comment "Staff cancellation (§9.4)" since it
 * was written, and `capture-payment` has been staff-gated for as long. The console had no
 * `app/api/bookings` directory at all, so `booking.cancel` and `booking.update_status` were
 * grantable in the role form, labelled in Arabic, shipped in the built-in operations role — and
 * delegated nothing (found 2026-08-25). This is the surface, not new authority.
 *
 * ## Availability is the API's answer, not this component's
 *
 * `actions` comes from the detail payload, computed by `allowedTransitions` — the same table
 * `assertTransition` enforces with. A staff actor may cancel from `pending_confirmation`,
 * `confirmed`, `checked_in` (via dispute) and `disputed`, and NOT from `pending_payment`, where
 * the actors are system and customer. Re-deriving that list over here would be a second source of
 * truth for the one question where being wrong means offering a control the API is about to
 * refuse.
 *
 * The reader's own capabilities are the caller's half — see the page. Both are re-checked by the
 * API, so neither is the security boundary; together they decide what is worth offering.
 */
export function BookingActions({
  reference,
  canCancel,
  canCapture,
}: {
  reference: string;
  /** Holds `booking.cancel` AND the booking's state permits it. */
  canCancel: boolean;
  /** Holds `booking.update_status` AND the booking is awaiting payment. */
  canCapture: boolean;
}) {
  const router = useRouter();

  const [open, setOpen] = useState<'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(path: string, body: unknown, success: string): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);
    setDone(null);

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
        const payload: unknown = await response.json().catch(() => null);

        /*
          `apiErrorOf`, never `payload.message`.

          The API answers a CODE and carries an English sentence beside it for logs. Reading that
          sentence would print English on an Arabic screen — the defect that cost the payout
          controls all eleven of their refusals on 2026-08-24.
        */
        setError(apiErrorOf(payload));
        setBusy(false);

        return;
      }

      setDone(success);
      setOpen(null);
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    }

    setBusy(false);
  }

  const path = (step: string): string =>
    `/api/bookings/${encodeURIComponent(reference)}/${step}`;

  /*
    Nothing to offer — but a notice may still be owed.

    The same shape as `ViolationActions`: capturing a payment moves the booking out of
    `pending_payment`, so the `router.refresh()` fired one line after `setDone` is what takes the
    control away. Returning `null` on that refresh would delete the confirmation in the tick it
    was written (`O-staff-6`, 2026-08-25). So the controls may go and the notice stays.
  */
  const idle = !canCancel && !canCapture;

  if (idle && !error && !done) return null;

  return (
    <section className="grid gap-2">
      <h2 className="mb-1 text-lg text-text">{t.sections.bookingDetail.actions}</h2>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {error}
        </p>
      ) : null}
      {done ? (
        <p
          role="status"
          className="rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm text-ok"
        >
          {done}
        </p>
      ) : null}

      {idle ? null : (
        <div className="flex flex-wrap gap-2">
          {canCapture ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void submit(
                  path('capture-payment'),
                  undefined,
                  t.sections.bookingDetail.paymentCaptured,
                );
              }}
              className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-3 py-1.5 text-[11.5px] text-muted hover:border-gold/50 hover:text-gold disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
            >
              {busy
                ? t.sections.bookingDetail.capturing
                : t.sections.bookingDetail.capturePayment}
            </button>
          ) : null}
          {canCancel ? (
            <button
              type="button"
              onClick={() => setOpen(open === 'cancel' ? null : 'cancel')}
              className={`inline-flex min-h-10 cursor-pointer items-center rounded-lg border px-3 py-1.5 text-[11.5px] lg:min-h-0 ${
                open === 'cancel'
                  ? 'border-bad text-bad'
                  : 'border-bad/50 text-bad hover:border-bad'
              }`}
            >
              {t.sections.bookingDetail.cancelBooking}
            </button>
          ) : null}
        </div>
      )}

      {/* The clock this starts, said before it is started. */}
      {canCapture ? (
        <p className="text-[11px] text-faint">{t.sections.bookingDetail.captureHint}</p>
      ) : null}

      {open === 'cancel' ? (
        <form
          className="grid gap-1.5 rounded-lg border border-bad/30 bg-bad/5 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const reason = text(new FormData(event.currentTarget), 'reason').trim();

            void submit(
              path('cancel'),
              { reason },
              t.sections.bookingDetail.bookingCancelled,
            );
          }}
        >
          {/* The consequence first: this one ends a stay and the customer reads the reason. */}
          <p className="text-[11.5px] text-bad">{t.sections.bookingDetail.cancelHint}</p>

          <label className="grid gap-1">
            <span className="text-[11px] text-faint">
              {t.sections.bookingDetail.cancelReasonLabel}
            </span>
            {/*
              `minLength` matches `bookingCancelSchema`'s floor so the browser refuses first. No
              `dir`: a field a person types into follows the page (docs/i18n.md §9).
            */}
            <textarea
              name="reason"
              required
              minLength={BOOKING_CANCEL_REASON_MIN}
              maxLength={1000}
              rows={2}
              disabled={busy}
              className="rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text disabled:cursor-not-allowed"
            />
            <span className="text-[10.5px] text-faint">
              {t.sections.bookingDetail.cancelReasonHint}
            </span>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg border border-bad/50 px-4 py-2 text-[12.5px] font-bold text-bad hover:bg-bad/10 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
          >
            {busy
              ? t.sections.bookingDetail.cancelling
              : t.sections.bookingDetail.cancelBooking}
          </button>
        </form>
      ) : null}
    </section>
  );
}
