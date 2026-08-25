'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { BOOKING_CANCEL_REASON_MIN, ENFORCEMENT_REASON_MIN } from '@safra/contracts';

import { text } from '@/lib/form';
import { apiErrorOf, t } from '@/lib/strings';

/** Which staff moves this booking's STATE permits, from the API's own transition table. */
export type BookingActionAvailability = {
  cancel: boolean;
  confirm: boolean;
  checkIn: boolean;
  undoCheckIn: boolean;
  complete: boolean;
  capturePayment: boolean;
};

/** The two moves that must say WHY, and the field each one writes. */
type Explained = 'cancel' | 'confirm';

/**
 * Everything a staff actor can do to a booking (§6.3, §6.4, §9.4).
 *
 * ## Six controls, one shape
 *
 * Four are a single press — check in, undo, complete, confirm receipt of a transfer — and two open
 * a form because they must carry a reason. Cancelling ends a stay the customer has paid for, and
 * confirming on the partner's behalf is SAFRA answering for a business that did not answer: both
 * are decisions somebody will reconstruct later, and a decision nobody can explain is one nobody
 * should be able to make.
 *
 * ## What is offered is the API's answer, not this component's
 *
 * `available` comes from the detail payload, computed by `allowedTransitions` — the same table
 * `assertTransition` enforces with. This file contains no rule about which status permits what,
 * deliberately: a second copy of the state machine over here is the one disagreement that shows a
 * control the API is about to refuse. The reader's capabilities are ANDed in by the page.
 *
 * ## Confirming receipt is scoped, and that is the answer to a real question
 *
 * Bashar asked (2026-08-25) why a human confirms a payment a provider has already verified. For a
 * card or Klarna nobody does — the webhook calls `markPaid`. The control appears only where the
 * rail sends no webhook: `ManualTransferProvider` is `isOffline`, its `parseWebhook()` returns null
 * on purpose, and banks do not call anybody. The API decides that from the booking's latest
 * payment attempt; see `awaitsOfflineTransfer`.
 */
export function BookingActions({
  reference,
  available,
  can,
}: {
  reference: string;
  available: BookingActionAvailability;
  /** What this READER may do — the page's half, from `readerPermissions()`. */
  can: {
    cancel: boolean;
    updateStatus: boolean;
    checkIn: boolean;
  };
}) {
  const router = useRouter();

  const [open, setOpen] = useState<Explained | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(step: string, body: unknown, success: string): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);
    setDone(null);

    try {
      const response = await fetch(
        `/api/bookings/${encodeURIComponent(reference)}/${step}`,
        {
          method: 'POST',
          ...(body === undefined
            ? {}
            : {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              }),
        },
      );

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);

        /*
          `apiErrorOf`, never `payload.message`. The API answers a CODE and carries an English
          sentence beside it for logs; printing that would put English on an Arabic screen — the
          defect that cost the payout controls all eleven of their refusals on 2026-08-24.
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

  const copy = t.sections.bookingDetail;

  /*
    Each control is offered only where the STATE permits it AND this reader may do it.

    Both halves are re-checked by the API, so neither is the security boundary — a person who
    deletes a `disabled` attribute or posts by hand meets the guard, not this. Together they decide
    what is worth drawing.
  */
  const offer = {
    confirm: available.confirm && can.updateStatus,
    capture: available.capturePayment && can.updateStatus,
    checkIn: available.checkIn && can.checkIn,
    undoCheckIn: available.undoCheckIn && can.checkIn,
    complete: available.complete && can.updateStatus,
    cancel: available.cancel && can.cancel,
  };

  /*
    Nothing to offer — but a notice may still be owed.

    Every one of these moves changes the status, so the `router.refresh()` fired one line after
    `setDone` is what takes the control away: completing a stay removes «إنهاء الإقامة», and on a
    completed booking nothing else is offered either. Returning `null` on that refresh would delete
    the confirmation in the tick it was written (`O-staff-6`, 2026-08-25).
  */
  const idle = !Object.values(offer).some(Boolean);

  if (idle && !error && !done) return null;

  return (
    <section className="grid gap-2">
      <h2 className="mb-1 text-lg text-text">{copy.actions}</h2>

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
          {offer.confirm ? (
            <Toggle
              label={copy.confirmBooking}
              active={open === 'confirm'}
              onClick={() => setOpen(open === 'confirm' ? null : 'confirm')}
            />
          ) : null}
          {offer.capture ? (
            <Press
              busy={busy}
              idle={copy.capturePayment}
              working={copy.capturing}
              onClick={() =>
                void submit('capture-payment', undefined, copy.paymentCaptured)
              }
            />
          ) : null}
          {offer.checkIn ? (
            <Press
              busy={busy}
              idle={copy.checkIn}
              working={copy.checkingIn}
              onClick={() => void submit('check-in', undefined, copy.checkedIn)}
            />
          ) : null}
          {offer.undoCheckIn ? (
            <Press
              busy={busy}
              idle={copy.undoCheckIn}
              working={copy.undoingCheckIn}
              onClick={() => void submit('undo-check-in', undefined, copy.checkInUndone)}
            />
          ) : null}
          {offer.complete ? (
            <Press
              busy={busy}
              idle={copy.completeStay}
              working={copy.completing}
              onClick={() => void submit('complete', undefined, copy.stayCompleted)}
            />
          ) : null}
          {offer.cancel ? (
            <Toggle
              label={copy.cancelBooking}
              active={open === 'cancel'}
              onClick={() => setOpen(open === 'cancel' ? null : 'cancel')}
              danger
            />
          ) : null}
        </div>
      )}

      {/* Each hint sits under the control it explains, and only while that control is offered. */}
      {offer.capture ? <Hint>{copy.captureHint}</Hint> : null}
      {offer.complete ? <Hint>{copy.completeHint}</Hint> : null}

      {open === 'confirm' ? (
        <Reasoned
          busy={busy}
          tone="gold"
          hint={copy.confirmHint}
          label={copy.confirmReasonLabel}
          fieldHint={copy.confirmReasonHint}
          min={ENFORCEMENT_REASON_MIN}
          submitLabel={busy ? copy.confirming : copy.confirmBooking}
          onSubmit={(reason) =>
            void submit('staff-confirm', { reason }, copy.bookingConfirmed)
          }
        />
      ) : null}

      {open === 'cancel' ? (
        <Reasoned
          busy={busy}
          tone="bad"
          hint={copy.cancelHint}
          label={copy.cancelReasonLabel}
          fieldHint={copy.cancelReasonHint}
          min={BOOKING_CANCEL_REASON_MIN}
          submitLabel={busy ? copy.cancelling : copy.cancelBooking}
          onSubmit={(reason) => void submit('cancel', { reason }, copy.bookingCancelled)}
        />
      ) : null}
    </section>
  );
}

/** A control that acts on the first press. */
function Press({
  busy,
  idle,
  working,
  onClick,
}: {
  busy: boolean;
  idle: string;
  working: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-3 py-1.5 text-[11.5px] text-muted hover:border-gold/50 hover:text-gold disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
    >
      {busy ? working : idle}
    </button>
  );
}

/**
 * A control that opens a form, because the move has to carry a reason.
 *
 * `danger` marks the one that ends a stay somebody paid for. Same tone `ViolationActions` gives
 * escalation: a control with a different consequence should not look like the ones beside it.
 */
function Toggle({
  label,
  active,
  onClick,
  danger,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  const tone = danger
    ? 'border-bad/50 text-bad hover:border-bad'
    : 'border-line text-muted hover:border-gold/50 hover:text-gold';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-10 cursor-pointer items-center rounded-lg border px-3 py-1.5 text-[11.5px] lg:min-h-0 ${
        active ? (danger ? 'border-bad text-bad' : 'border-gold/60 text-gold') : tone
      }`}
    >
      {label}
    </button>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-faint">{children}</p>;
}

/**
 * The form behind a move that must explain itself.
 *
 * The consequence is stated BEFORE the field, as on «تعليق الحساب»: somebody about to end a stay
 * or answer for a partner should read what that does while the box is still empty.
 */
function Reasoned({
  busy,
  tone,
  hint,
  label,
  fieldHint,
  min,
  submitLabel,
  onSubmit,
}: {
  busy: boolean;
  tone: 'bad' | 'gold';
  hint: string;
  label: string;
  fieldHint: string;
  min: number;
  submitLabel: string;
  onSubmit: (reason: string) => void;
}) {
  const frame =
    tone === 'bad' ? 'border-bad/30 bg-bad/5' : 'border-gold/30 bg-gold/[0.06]';

  return (
    <form
      className={`grid gap-1.5 rounded-lg border p-3 ${frame}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(text(new FormData(event.currentTarget), 'reason').trim());
      }}
    >
      <p className={`text-[11.5px] ${tone === 'bad' ? 'text-bad' : 'text-gold'}`}>
        {hint}
      </p>

      <label className="grid gap-1">
        <span className="text-[11px] text-faint">{label}</span>
        {/*
          `minLength` matches the schema's own floor so the browser refuses first — the server
          still refuses, so a drift costs a round trip rather than a bad row. No `dir`: a field a
          person types into follows the page (docs/i18n.md §9).
        */}
        <textarea
          name="reason"
          required
          minLength={min}
          maxLength={1000}
          rows={2}
          disabled={busy}
          className="rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text disabled:cursor-not-allowed"
        />
        <span className="text-[10.5px] text-faint">{fieldHint}</span>
      </label>

      <button
        type="submit"
        disabled={busy}
        className={`inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg border px-4 py-2 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 ${
          tone === 'bad'
            ? 'border-bad/50 text-bad hover:bg-bad/10'
            : 'border-gold/50 text-gold hover:bg-gold/10'
        }`}
      >
        {submitLabel}
      </button>
    </form>
  );
}
