'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t, apiErrorOf } from '@/lib/strings';

/**
 * Closing a dispute (design handoff §8, "فتح النزاع ←").
 *
 * ## Collapsed until asked for
 *
 * The card shows a button; the form appears when it is pressed. Every unresolved dispute on the
 * page would otherwise carry a textarea and an amount field, which turns a scannable queue into a
 * wall of forms — and the queue's job is to help somebody decide what to pick up.
 *
 * ## The button cannot arm without a decision
 *
 * A resolution of at least ten characters is required, matching the API and the database CHECK.
 * Enforcing it here as well is not redundancy for its own sake: it is the difference between a
 * disabled button and a round trip that comes back with a validation error the operator has to
 * decode.
 *
 * ## Compensation is opt-in and states what it does
 *
 * Ticking it credits the customer's wallet immediately, in the same transaction as the closure.
 * The label says so, because "compensation" alone does not distinguish a promise from a payment.
 */
export function CloseDisputeForm({ reference }: { reference: string }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<'resolved' | 'rejected'>('resolved');
  const [resolution, setResolution] = useState('');
  const [compensate, setCompensate] = useState(false);
  const [compensationAmount, setCompensationAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
    A compensation amount must look like money before the button arms. The API and the database
    both re-check; this stops the obvious typo from costing a round trip.
  */
  const amountValid =
    !compensate || /^\d{1,10}(\.\d{1,2})?$/.test(compensationAmount.trim());
  const ready = resolution.trim().length >= 10 && amountValid && !busy;

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/disputes/${encodeURIComponent(reference)}/close`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outcome,
            resolution: resolution.trim(),
            ...(compensate
              ? {
                  compensationAmount: compensationAmount.trim(),
                  /*
                    USD, because that is the currency every operational amount on this console is
                    denominated in. A currency picker would invite crediting SYP by accident,
                    which is wrong by four orders of magnitude.

                    NOT because every wallet is USD — this said so and it was false: 512 of the
                    11,801 wallets are EUR. The API converts through SYP into whatever currency
                    the customer's wallet actually holds, so what is sent here is the amount SAFRA
                    decided to pay, not an assumption about where it lands.
                  */
                  compensationCurrency: 'USD',
                }
              : {}),
          }),
        },
      );

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setError(apiErrorOf(payload));

        return;
      }

      setOpen(false);
      setResolution('');
      setCompensate(false);
      setCompensationAmount('');
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-3 flex">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="cursor-pointer rounded-lg border border-[rgba(var(--goldA),0.4)] px-4.5 py-2 text-xs font-bold text-gold transition-colors hover:bg-[rgba(var(--goldA),0.08)]"
        >
          {t.sections.disputes.open}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 grid gap-3 rounded-[10px] border border-line bg-field p-3.5">
      <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
        {t.sections.disputes.outcome}
        <select
          value={outcome}
          onChange={(event) =>
            setOutcome(event.target.value === 'rejected' ? 'rejected' : 'resolved')
          }
          className="cursor-pointer rounded-[9px] border border-line bg-card px-3 py-2 text-[12.5px] text-text"
        >
          <option value="resolved">{t.sections.disputes.outcomeResolved}</option>
          <option value="rejected">{t.sections.disputes.outcomeRejected}</option>
        </select>
      </label>

      <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
        {t.sections.disputes.resolution}
        <textarea
          value={resolution}
          onChange={(event) => setResolution(event.target.value)}
          rows={3}
          maxLength={2000}
          className="rounded-[9px] border border-line bg-card px-3 py-2 text-[12.5px] leading-relaxed text-text"
        />
        <span className="text-[10.5px] font-normal text-faint2">
          {t.sections.disputes.resolutionHint}
        </span>
      </label>

      <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-text2">
        <input
          type="checkbox"
          checked={compensate}
          onChange={(event) => setCompensate(event.target.checked)}
          className="size-[15px] cursor-pointer accent-gold"
        />
        {t.sections.disputes.compensation}
      </label>

      {compensate ? (
        <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
          <span className="sr-only">{t.sections.disputes.compensation}</span>
          <input
            value={compensationAmount}
            onChange={(event) => setCompensationAmount(event.target.value)}
            inputMode="decimal"
            placeholder="10.00"
            /* No `dir`: a field a person types into follows the page (docs/i18n.md §9). */
            aria-invalid={!amountValid}
            className={`w-40 rounded-[9px] border bg-card px-3 py-2 text-[13px] text-text ${
              amountValid ? 'border-line' : 'border-bad'
            }`}
          />
          <span className="text-[10.5px] font-normal text-faint2">
            {t.sections.disputes.compensationHint}
          </span>
        </label>
      ) : null}

      {error ? (
        <p role="alert" className="text-[11.5px] text-bad">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2.5">
        <button
          type="button"
          disabled={!ready}
          onClick={() => void submit()}
          className="cursor-pointer rounded-[9px] bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-5 py-2 text-[12.5px] font-extrabold text-[#241A05] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? t.sections.disputes.closing : t.sections.disputes.confirmClose}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="cursor-pointer rounded-[9px] border border-line px-5 py-2 text-[12.5px] text-muted"
        >
          {t.sections.settings.cancel}
        </button>
      </div>
    </div>
  );
}
