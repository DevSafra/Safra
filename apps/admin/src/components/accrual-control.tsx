'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useConfirm } from '@safra/ui';

import { apiErrorOf, t } from '@/lib/strings';

/**
 * «تجميع المستحقات الآن» — the accrual sweep, with a person able to press it.
 *
 * ## Why it is here rather than on a payout
 *
 * Accrual is not a transition of one transfer; it sweeps every partner and decides what is due. So
 * it belongs beside the line that says when it last ran — an operator opening this registry to
 * answer «where is my money» reads that timestamp, and the useful next move is right there rather
 * than on some other screen.
 *
 * ## It asks first, and the question states what happens
 *
 * `useConfirm()` from `@safra/ui`, per the standing rule that the browser's own popup is never
 * called. Not `tone: 'danger'`: this creates obligations, it does not destroy anything, and
 * painting it red would spend the one colour that means «you cannot undo this» on the one payout
 * action that is entirely undoable — cancelling a payout returns its bookings to accrual.
 *
 * The message says no money moves, because that is the reasonable fear when pressing a button on
 * a payouts screen. Release and payment are separate steps behind separate confirmations.
 *
 * ## The refusal is the API's words, not «something went wrong»
 *
 * A caller without `PAYOUT_EXECUTE` is refused by the API, and `apiErrorOf` reads the code it
 * sends. This component does not gate on the permission itself — the same reasoning
 * `PayoutActions` records: hiding a control is a courtesy to the operator, the endpoint is the
 * control.
 */
export function AccrualControl() {
  const router = useRouter();
  const c = t.sections.payouts;
  const { ask, dialog } = useConfirm();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function run(): Promise<void> {
    if (busy) return;

    const confirmed = await ask({
      title: c.accrueTitle,
      message: c.accrueMessage,
      confirmLabel: c.accrueConfirm,
      cancelLabel: t.sections.dialog.cancel,
    });

    if (!confirmed) return;

    setBusy(true);
    setError(null);
    setDone(false);

    try {
      const response = await fetch('/api/payouts/accrue', { method: 'POST' });

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      setDone(true);
      /*
        The registry is a server component, so the new periods arrive on a refresh rather than
        from this handler. `done` is set as well: a refresh that lands quickly looks like nothing
        happened, and «I pressed it and the screen did not change» is how an operator presses it
        four times.
      */
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        onClick={() => {
          void run();
        }}
        disabled={busy}
        className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.4)] bg-[rgba(var(--goldA),0.06)] px-3 text-[12.5px] font-bold text-gold transition-transform duration-150 ease-out active:scale-[0.98] disabled:cursor-default disabled:opacity-60 lg:min-h-0 lg:py-1.5"
      >
        {busy ? c.accrueBusy : c.accrueNow}
      </button>

      {error === null ? null : <p className="text-[11.5px] text-bad">{error}</p>}
      {done && error === null ? (
        <p className="text-[11.5px] text-ok">{c.accrueDone}</p>
      ) : null}

      {dialog}
    </div>
  );
}
