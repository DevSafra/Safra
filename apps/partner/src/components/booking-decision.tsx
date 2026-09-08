'use client';

import { useState } from 'react';

import { useConfirm } from '@safra/ui';
import { fill, ltrIsolate } from '@safra/i18n';

import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { t } from '@/lib/strings';

/**
 * قبول / رفض — the partner answering a booking request inside the two-hour window (§6.4, §7.1).
 *
 * ## Why rejection asks for a reason and acceptance does not
 *
 * That asymmetry is the API's, not this component's: `partnerBookingDecisionSchema` refuses a
 * rejection with no reason. SAFRA has to tell the guest something, and «رُفض» on its own is the
 * answer that generates a support ticket. Accepting needs no explanation.
 *
 * ## Why acceptance goes through the dialog (finding 215)
 *
 * It used to be an inline two-step whose two steps looked the same. «قبول» set a confirm state
 * whose primary button was ALSO «قبول», in the same green, in the same place; the only moving part
 * was «رفض» becoming «إلغاء». The first press posts nothing, so a partner who pressed once and
 * looked away had not accepted — on the most time-critical action in the platform, a two-hour
 * window with a $10 fine at the end of it.
 *
 * Bashar, 2026-09-07: «I want the action to be extremely clear and difficult to misunderstand. The
 * user should always know whether the booking has actually been accepted or not.» So three things
 * changed, and each answers one way of misunderstanding it:
 *
 * 1. The confirm is `useConfirm()` — a modal, so it cannot be mistaken for the page underneath.
 * 2. Its confirm reads «نعم، أقبل الحجز», different WORDS from the trigger, and it names the
 *    booking: a queue being scanned is exactly where the wrong row gets answered.
 * 3. The row then SAYS what was decided instead of vanishing. `router.refresh()` used to drop the
 *    request from the queue the moment it was answered, and «it disappeared» reads the same as
 *    «the deadline passed».
 */
export function BookingDecision({
  reference,
  unitName,
  checkIn,
  checkOut,
  amount,
}: {
  readonly reference: string;
  /** Named in the confirm, so the partner sees WHICH request they are about to commit to. */
  readonly unitName: string;
  readonly checkIn: string;
  readonly checkOut: string;
  /** Already formatted with its currency by the caller — no amount is read without one. */
  readonly amount: string;
}) {
  const d = t.dashboard;
  const { ask, dialog } = useConfirm();

  const [mode, setMode] = useState<'idle' | 'reject'>('idle');
  const [decided, setDecided] = useState<'accepted' | 'rejected' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: 'confirm' | 'reject', reason: string) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/bookings/${encodeURIComponent(reference)}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          }),
        },
      );

      if (!response.ok) {
        setError(refusalFor(await codeOfResponse(response)) ?? d.decisionFailed);
        setBusy(false);
        return;
      }

      /*
        The outcome is stated HERE and the queue is left alone until the partner navigates.

        `router.refresh()` would re-render the list without this request in it, which is the same
        picture an expired deadline leaves behind. Saying it in place is the whole point of the
        finding; the queue is server-rendered and drops the row on the next visit anyway.
      */
      setDecided(decision === 'confirm' ? 'accepted' : 'rejected');
      setMode('idle');
      setBusy(false);
    } catch {
      setError(d.unreachable);
      setBusy(false);
    }
  }

  async function accept() {
    /*
      Every Latin value is ISOLATED, and this is not a nicety — it was measured.

      The dialog's message is a plain string on a right-to-left line, so the bidi algorithm orders
      the runs inside it. Read off the layout boxes on 2026-09-07, `2027-07-12` rendered as
      «12-07-2027» — three number runs placed right to left — and `$131.99` rendered as «131.99$»
      with the currency moved to the far end. A partner deciding in a two-hour window was being
      shown a date whose meaning is ambiguous and an amount whose currency had wandered.

      `ltrIsolate` is the project's answer for exactly this: the value keeps its own order and
      cannot disturb the Arabic around it. `unit` is Arabic and is deliberately NOT isolated —
      wrapping a label makes it collide with whatever precedes it.
    */
    const go = await ask({
      title: d.acceptTitle,
      message: `${fill(d.acceptBody, {
        reference: ltrIsolate(reference),
        unit: unitName,
        checkIn: ltrIsolate(checkIn),
        checkOut: ltrIsolate(checkOut),
        amount: ltrIsolate(amount),
      })}\n\n${d.acceptWarning}`,
      confirmLabel: d.acceptConfirm,
      cancelLabel: d.cancel,
    });

    if (go) await submit('confirm', '');
  }

  if (decided) {
    const accepted = decided === 'accepted';

    return (
      /*
        `role="status"` and not an `alert`: this is the RESULT of something the partner just did,
        so it is announced politely rather than interrupting whatever they moved on to. It fades
        and rises in — a state that pops into existence reads as a repaint, not as an answer.
      */
      <p
        data-decided
        role="status"
        className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border p-3 text-[14px] ${
          accepted ? 'border-ok/40 bg-ok/10' : 'border-line bg-field'
        }`}
        style={{ animation: 'safra-decided 200ms cubic-bezier(0.23,1,0.32,1) both' }}
      >
        <span className={`font-bold ${accepted ? 'decided-ink' : 'text-muted'}`}>
          {accepted ? d.accepted : d.rejectedDone}
        </span>
        <span className="text-faint">{accepted ? d.acceptedNote : d.rejectedNote}</span>
      </p>
    );
  }

  if (mode === 'reject') {
    return (
      <form
        className="grid w-full gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get('reason');
          void submit('reject', typeof value === 'string' ? value : '');
        }}
      >
        <label
          htmlFor={`reason-${reference}`}
          className="text-[13px] leading-relaxed text-muted"
        >
          {d.rejectReason}
        </label>
        <textarea
          id={`reason-${reference}`}
          name="reason"
          rows={2}
          required
          className="rounded-lg border border-line bg-field px-3 py-2 text-[14px] text-text"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="min-h-10 cursor-pointer rounded-lg border border-bad/50 px-4 py-2 text-[14px] font-bold text-bad transition-transform duration-150 ease-out-strong active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none lg:min-h-0"
          >
            {busy ? d.working : d.rejectConfirm}
          </button>
          <button
            type="button"
            onClick={() => setMode('idle')}
            className="min-h-10 cursor-pointer rounded-lg border border-line px-4 py-2 text-[14px] text-muted transition-transform duration-150 ease-out-strong active:scale-[0.97] motion-reduce:transition-none lg:min-h-0"
          >
            {d.cancel}
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-[13px] text-bad">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error ? (
        <p role="alert" className="w-full text-[13px] text-bad">
          {error}
        </p>
      ) : null}

      {/* The handoff's gold-adjacent green gradient for the primary action, verbatim. */}
      <button
        type="button"
        disabled={busy}
        onClick={() => void accept()}
        className="min-h-10 cursor-pointer rounded-lg border-none bg-[linear-gradient(135deg,#8FD9A8,#4F9E6B)] px-4 py-2 text-[14px] font-extrabold text-[#0A2013] transition-transform duration-150 ease-out-strong active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none lg:min-h-0"
      >
        {busy ? d.working : d.accept}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setMode('reject')}
        className="min-h-10 cursor-pointer rounded-lg border border-bad/50 bg-transparent px-4 py-2 text-[14px] font-bold text-bad transition-transform duration-150 ease-out-strong active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none lg:min-h-0"
      >
        {d.reject}
      </button>

      {dialog}
    </div>
  );
}
