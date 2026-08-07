'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
 * ## Why the confirm step exists for both
 *
 * Both decisions are irreversible and both move money — accepting commits the partner to the stay,
 * rejecting after payment is itself a violation with a fine attached. A single click on a queue a
 * partner is scanning is how the wrong booking gets answered.
 */
export function BookingDecision({ reference }: { readonly reference: string }) {
  const router = useRouter();

  const [mode, setMode] = useState<'idle' | 'accept' | 'reject'>('idle');
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
        setError(t.dashboard.decisionFailed);
        setBusy(false);
        return;
      }

      /* The queue is server-rendered, so the answered request leaves it on refresh. */
      router.refresh();
      setMode('idle');
      setBusy(false);
    } catch {
      setError(t.dashboard.unreachable);
      setBusy(false);
    }
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
          className="text-[11.5px] leading-relaxed text-muted"
        >
          {t.dashboard.rejectReason}
        </label>
        <textarea
          id={`reason-${reference}`}
          name="reason"
          rows={2}
          required
          className="rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="min-h-10 cursor-pointer rounded-lg border border-bad/50 px-4 py-2 text-[12.5px] font-bold text-bad disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
          >
            {busy ? t.dashboard.working : t.dashboard.rejectConfirm}
          </button>
          <button
            type="button"
            onClick={() => setMode('idle')}
            className="min-h-10 cursor-pointer rounded-lg border border-line px-4 py-2 text-[12.5px] text-muted lg:min-h-0"
          >
            {t.dashboard.cancel}
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-[11.5px] text-bad">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error ? (
        <p role="alert" className="w-full text-[11.5px] text-bad">
          {error}
        </p>
      ) : null}

      {mode === 'accept' ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit('confirm', '')}
            className="min-h-10 cursor-pointer rounded-lg border-none bg-[linear-gradient(135deg,#8FD9A8,#4F9E6B)] px-4 py-2 text-[12.5px] font-extrabold text-[#0A2013] disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
          >
            {busy ? t.dashboard.working : t.dashboard.accept}
          </button>
          <button
            type="button"
            onClick={() => setMode('idle')}
            className="min-h-10 cursor-pointer rounded-lg border border-line px-4 py-2 text-[12.5px] text-muted lg:min-h-0"
          >
            {t.dashboard.cancel}
          </button>
        </>
      ) : (
        <>
          {/* The handoff's gold-adjacent green gradient for the primary action, verbatim. */}
          <button
            type="button"
            onClick={() => setMode('accept')}
            className="min-h-10 cursor-pointer rounded-lg border-none bg-[linear-gradient(135deg,#8FD9A8,#4F9E6B)] px-4 py-2 text-[12.5px] font-extrabold text-[#0A2013] lg:min-h-0"
          >
            {t.dashboard.accept}
          </button>
          <button
            type="button"
            onClick={() => setMode('reject')}
            className="min-h-10 cursor-pointer rounded-lg border border-bad/50 bg-transparent px-4 py-2 text-[12.5px] font-bold text-bad lg:min-h-0"
          >
            {t.dashboard.reject}
          </button>
        </>
      )}
    </div>
  );
}
