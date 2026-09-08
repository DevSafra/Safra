'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useConfirm } from '@safra/ui';

import { apiErrorOf, fill, t } from '@/lib/strings';

/**
 * «تأكيد إرسال الاسترداد» — finance confirming an offline refund actually left the account.
 *
 * ## Why this control has to exist (finding 222, Bashar 2026-09-08)
 *
 * *«An offline refund must have an equivalent completion step, just like a payment capture.»* He
 * called it a launch blocker.
 *
 * The reversal of the partner's payable and SAFRA's commission is posted when a refund reaches
 * `completed`, and correctly not before — a refund still `processing` has returned nothing. For a
 * gateway the webhook posts it. For an offline rail nothing did: `ManualTransferProvider.refund()`
 * can only report `processing` because a human executes the transfer, and `parseWebhook()` returns
 * null because banks send none; `InternalCaptureProvider`, behind every staff-recorded capture, is
 * the same. 236 refunds worth $47,326.37 sat pending for ever, the customer's page said «in
 * progress» indefinitely, and decision 198's proportional reduction never happened.
 *
 * So this is the mirror of «تأكيد استلام الحوالة» — that records money coming IN on a rail that
 * cannot report for itself, this records money going OUT.
 *
 * ## It is offered PER REFUND, not per booking
 *
 * A booking may carry several refunds and only some settleable — a wallet-only refund completed at
 * once and needs nothing, a gateway refund is confirmed by its webhook and must NOT be settled by
 * hand. `settleable` comes from the API for exactly that reason: the console asking the question
 * itself would be a second answer to it, and the API's is the one the route enforces.
 *
 * ## `tone: 'danger'`, and the reason is the focus rather than the colour
 *
 * Nothing is deleted, but this posts a reversal that takes money off a partner's payable and cannot
 * be undone from any screen. Danger paints the confirm red AND puts the initial focus on «إلغاء»,
 * so somebody pressing Enter out of habit does not move money.
 */
export function SettleRefund({
  refundId,
  amount,
  currency,
}: {
  readonly refundId: string;
  /** Named in the question, so the reader confirms an AMOUNT rather than a button. */
  readonly amount: string;
  readonly currency: string;
}) {
  const router = useRouter();
  const c = t.sections.bookingDetail;
  const { ask, dialog } = useConfirm();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function settle(): Promise<void> {
    if (busy) return;

    const confirmed = await ask({
      title: c.settleTitle,
      message: fill(c.settleMessage, { amount, currency }),
      confirmLabel: c.settleConfirm,
      cancelLabel: t.sections.dialog.cancel,
      tone: 'danger',
    });

    if (!confirmed) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/refunds/${encodeURIComponent(refundId)}/settle`,
        { method: 'POST' },
      );

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      /*
        The page is server-rendered, so a refresh is what shows the reversal: the refund becomes
        «مكتمل», «المستحق للشريك» drops, and the ledger group appears on the timeline. Re-reading is
        also the honest confirmation — this component asserting success would be claiming an outcome
        it has not seen.
      */
      router.refresh();
    } catch {
      setError(c.settleUnreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void settle()}
        className="min-h-10 cursor-pointer rounded-lg border border-gold/50 px-3 py-1.5 text-[12px] font-bold text-gold transition-transform duration-150 ease-out-strong active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none lg:min-h-0"
      >
        {busy ? c.settleWorking : c.settleAction}
      </button>

      {error ? (
        <p role="alert" className="mt-1.5 text-[11.5px] text-bad">
          {error}
        </p>
      ) : null}

      {dialog}
    </div>
  );
}
