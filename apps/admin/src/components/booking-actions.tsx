'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  BOOKING_CANCEL_REASON_MIN,
  DISPUTE_KINDS,
  ENFORCEMENT_REASON_MIN,
} from '@safra/contracts';

import { text } from '@/lib/form';
import { Ltr } from '@/components/admin-table';
import { money } from '@/lib/format';
import { apiErrorOf, fill, label, t } from '@/lib/strings';

/** Which staff moves this booking's STATE permits, from the API's own transition table. */
export type BookingActionAvailability = {
  cancel: boolean;
  confirm: boolean;
  checkIn: boolean;
  undoCheckIn: boolean;
  complete: boolean;
  capturePayment: boolean;
  openDispute: boolean;
  refund: boolean;
  compensate: boolean;
};

/** The moves that open a form, because each has something the operator must say or choose. */
type Explained = 'cancel' | 'confirm' | 'dispute' | 'refund' | 'compensate';

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
  currencies,
}: {
  reference: string;
  available: BookingActionAvailability;
  /** What this READER may do — the page's half, from `readerPermissions()`. */
  can: {
    cancel: boolean;
    updateStatus: boolean;
    checkIn: boolean;
    manageDisputes: boolean;
    refund: boolean;
    adjustWallet: boolean;
  };
  /** ISO codes the wallet accepts, for the compensation form. */
  currencies: readonly string[];
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
    dispute: available.openDispute && can.manageDisputes,
    refund: available.refund && can.refund,
    compensate: available.compensate && can.adjustWallet,
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
          {offer.dispute ? (
            <Toggle
              label={copy.openDispute}
              active={open === 'dispute'}
              onClick={() => setOpen(open === 'dispute' ? null : 'dispute')}
            />
          ) : null}
          {offer.refund ? (
            <Toggle
              label={copy.refund}
              active={open === 'refund'}
              onClick={() => setOpen(open === 'refund' ? null : 'refund')}
            />
          ) : null}
          {offer.compensate ? (
            <Toggle
              label={copy.compensate}
              active={open === 'compensate'}
              onClick={() => setOpen(open === 'compensate' ? null : 'compensate')}
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

      {open === 'dispute' ? (
        <DisputeForm
          busy={busy}
          onSubmit={(body) => void submit('dispute', body, copy.disputeOpened)}
        />
      ) : null}

      {open === 'refund' ? (
        <RefundForm
          busy={busy}
          reference={reference}
          onSubmit={(reason) => void submit('refund', { reason }, copy.refundIssued)}
        />
      ) : null}

      {open === 'compensate' ? (
        <CompensationForm
          busy={busy}
          currencies={currencies}
          onSubmit={(body) => void submit('compensate', body, copy.compensated)}
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
        active ? (danger ? 'border-bad text-bad' : 'border-gold/60 text-gold-ink') : tone
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
      <p className={`text-[11.5px] ${tone === 'bad' ? 'text-bad' : 'text-gold-ink'}`}>
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
          className="rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text disabled:cursor-not-allowed"
        />
        <span className="text-[10.5px] text-faint">{fieldHint}</span>
      </label>

      <button
        type="submit"
        disabled={busy}
        className={`inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg border px-4 py-2 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 ${
          tone === 'bad'
            ? 'border-bad/50 text-bad hover:bg-bad/10'
            : 'border-gold/50 text-gold-ink hover:bg-gold/10'
        }`}
      >
        {submitLabel}
      </button>
    </form>
  );
}

/**
 * §9.4's «فتح نزاع» — a complaint SAFRA records on the customer's behalf.
 *
 * Three fields because a dispute is three decisions: which of §10's four kinds, the line the
 * queue shows, and the customer's own account of what happened. The kind is a select with no
 * default, for the reason `RaiseViolation`'s is: it decides what the partner is recorded as having
 * done, and a pre-filled one invites recording the wrong thing against a real business.
 */
function DisputeForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: { kind: string; title: string; description: string }) => void;
}) {
  const copy = t.sections.bookingDetail;

  return (
    <form
      className="grid gap-2 rounded-lg border border-gold/30 bg-gold/[0.06] p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);

        onSubmit({
          kind: text(form, 'kind'),
          title: text(form, 'title').trim(),
          description: text(form, 'description').trim(),
        });
      }}
    >
      {/* Both consequences before the first field: frozen money, and a changed booking status. */}
      <p className="text-[11.5px] text-gold-ink">{copy.disputeHint}</p>

      <label className="grid gap-1">
        <span className="text-[11px] text-faint">{copy.disputeKindLabel}</span>
        <select
          name="kind"
          required
          defaultValue=""
          disabled={busy}
          className="cursor-pointer rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text"
        >
          <option value="" disabled>
            {copy.pickDisputeKind}
          </option>
          {DISPUTE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {label(t.enums.disputeKind, kind)}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1">
        <span className="text-[11px] text-faint">{copy.disputeTitleLabel}</span>
        {/* No `dir`: a field a person types into follows the page (docs/i18n.md §9). */}
        <input
          name="title"
          required
          minLength={4}
          maxLength={120}
          disabled={busy}
          /*
            `min-h-10 lg:min-h-0` stated here, unlike on a button.

            `globals.css` gives the 40px touch floor to `button`, `select` and `summary` below
            `lg` — a text INPUT is not in that list, so it comes out at 38px on a phone and misses
            the rule by two pixels. Measured, not guessed.
          */
          className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text disabled:cursor-not-allowed lg:min-h-0"
        />
        <span className="text-[10.5px] text-faint">{copy.disputeTitleHint}</span>
      </label>

      <label className="grid gap-1">
        <span className="text-[11px] text-faint">{copy.disputeDescriptionLabel}</span>
        <textarea
          name="description"
          required
          minLength={20}
          maxLength={4000}
          rows={3}
          disabled={busy}
          className="rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text disabled:cursor-not-allowed"
        />
        <span className="text-[10.5px] text-faint">{copy.disputeDescriptionHint}</span>
      </label>

      <Submit busy={busy} label={busy ? copy.openingDispute : copy.openDispute} />
    </form>
  );
}

/**
 * §9.4's «استرداد» — issuing a refund at the figure the POLICY decides.
 *
 * ## The quote is fetched, not computed here
 *
 * `RefundService.quote` reads the cancellation policy snapshotted on the booking and applies §7.4's
 * tiers to it. The console shows what it says and sends only a reason: an amount typed here would
 * be an amount somebody could choose, which is exactly what the API refuses to accept.
 *
 * ## And it is shown BEFORE the button
 *
 * A refund is irreversible and its size depends on when the customer is cancelling. An operator who
 * cannot see the figure until after they have issued it is guessing.
 */
function RefundForm({
  busy,
  reference,
  onSubmit,
}: {
  busy: boolean;
  reference: string;
  onSubmit: (reason: string) => void;
}) {
  const copy = t.sections.bookingDetail;
  const [quote, setQuote] = useState<RefundQuote | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;

    void (async () => {
      try {
        const response = await fetch(
          `/api/bookings/${encodeURIComponent(reference)}/refund`,
        );

        /*
          A quote that cannot be fetched is NOT an error the operator has to resolve — it is one
          line of guidance missing from a form that still works. `REFUND_READ` and `REFUND_CREATE`
          are separate capabilities, so a finance member who may issue one and not quote it is a
          configuration this must degrade gracefully under rather than refuse to render for.
        */
        if (!response.ok) {
          if (live) setFailed(true);

          return;
        }

        const body = (await response.json()) as RefundQuote;

        if (live) setQuote(body);
      } catch {
        if (live) setFailed(true);
      }
    })();

    return () => {
      live = false;
    };
  }, [reference]);

  /* Nothing left to give back: the policy allows none, or it has all been refunded already. */
  const nothing = quote !== null && Number(quote.refundable) <= 0;

  return (
    <form
      className="grid gap-1.5 rounded-lg border border-gold/30 bg-gold/[0.06] p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(text(new FormData(event.currentTarget), 'reason').trim());
      }}
    >
      <p className="text-[11.5px] text-gold-ink">{copy.refundHint}</p>

      {/* The figure, as soon as it is known. `failed` is silent: the form still works. */}
      {quote && !nothing ? (
        <p className="text-[12.5px] text-text">
          <Ltr>
            {fill(copy.refundQuoteLine, {
              amount: money(quote.refundable),
              currency: quote.currencyCode,
              percent: String(quote.refundPercent),
              tier: quote.tierApplied,
            })}
          </Ltr>
          {Number(quote.walletAmount) > 0 ? (
            <span className="block text-[11px] text-faint">
              {fill(copy.refundToWallet, {
                amount: money(quote.walletAmount),
                currency: quote.currencyCode,
              })}
            </span>
          ) : null}
        </p>
      ) : null}

      {nothing ? <p className="text-[12px] text-faint">{copy.refundNothing}</p> : null}
      {failed ? <p className="text-[12px] text-faint">{t.errors.unknown}</p> : null}

      <label className="grid gap-1">
        <span className="text-[11px] text-faint">{copy.refundReasonLabel}</span>
        <textarea
          name="reason"
          required
          minLength={3}
          maxLength={500}
          rows={2}
          disabled={busy || nothing}
          className="rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text disabled:cursor-not-allowed"
        />
        <span className="text-[10.5px] text-faint">{copy.refundReasonHint}</span>
      </label>

      <Submit busy={busy || nothing} label={busy ? copy.refunding : copy.refund} />
    </form>
  );
}

/**
 * §9.4's «تعويض» — SAFRA's own goodwill credit, not a return of the payment.
 *
 * The currency is a SELECT over what the platform actually holds rates for, rather than a text
 * box: an amount with a currency nobody can convert is money that cannot be paid, and «10» in the
 * wrong one is wrong by four orders of magnitude between SYP and USD.
 */
function CompensationForm({
  busy,
  currencies,
  onSubmit,
}: {
  busy: boolean;
  currencies: readonly string[];
  onSubmit: (body: { amount: string; currency: string; note: string }) => void;
}) {
  const copy = t.sections.bookingDetail;

  return (
    <form
      className="grid gap-2 rounded-lg border border-gold/30 bg-gold/[0.06] p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);

        onSubmit({
          amount: text(form, 'amount').trim(),
          currency: text(form, 'currency'),
          note: text(form, 'note').trim(),
        });
      }}
    >
      <p className="text-[11.5px] text-gold-ink">{copy.compensateHint}</p>

      <div className="flex flex-wrap gap-2">
        <label className="grid gap-1">
          <span className="text-[11px] text-faint">{copy.compensateAmountLabel}</span>
          {/*
            `inputMode="decimal"` rather than `type="number"`: a number input's spinner and its
            locale-dependent parsing are both wrong for money, and the value is sent as a STRING
            because a JSON number is an IEEE-754 double.
          */}
          <input
            name="amount"
            required
            inputMode="decimal"
            pattern="\d{1,10}(\.\d{1,2})?"
            disabled={busy}
            className="w-32 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text disabled:cursor-not-allowed min-h-10 lg:min-h-0"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-[11px] text-faint">{copy.compensateCurrencyLabel}</span>
          <select
            name="currency"
            required
            disabled={busy}
            className="cursor-pointer rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text"
          >
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="grid gap-1">
        <span className="text-[11px] text-faint">{copy.compensateNoteLabel}</span>
        <textarea
          name="note"
          required
          minLength={10}
          maxLength={500}
          rows={2}
          disabled={busy}
          className="rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text disabled:cursor-not-allowed"
        />
        <span className="text-[10.5px] text-faint">{copy.compensateNoteHint}</span>
      </label>

      <Submit busy={busy} label={busy ? copy.compensating : copy.compensate} />
    </form>
  );
}

/** The one submit button these three forms share, so their affordance cannot drift apart. */
function Submit({ busy, label: text }: { busy: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg border border-gold/50 px-4 py-2 text-[12.5px] font-bold text-gold-ink hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
    >
      {text}
    </button>
  );
}

/** What `RefundService.quote` answers — the fields this form reads from it. */
type RefundQuote = {
  refundPercent: number;
  refundable: string;
  walletAmount: string;
  currencyCode: string;
  tierApplied: string;
};
