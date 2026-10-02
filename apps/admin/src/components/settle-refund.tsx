'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { normaliseBankAccount } from '@safra/contracts';
import { ltrIsolate } from '@safra/i18n';
import { useConfirm } from '@safra/ui';

import { text } from '@/lib/form';
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
 *
 * ## Back to the account the money came from (Bashar, 2026-10-02)
 *
 * The confirmation is a form, not a press: the account the refund was sent to and the bank's
 * reference for it. The API compares the account with the one the transfer came FROM and refuses
 * any other, and the database refuses a completed refund whose destination is not that account. A
 * payment confirmed before the sender's account was recorded asks for it here, once, from the
 * statement of the incoming transfer.
 */

export function SettleRefund({
  refundId,
  amount,
  currency,
  sourceLast4,
}: {
  readonly refundId: string;
  /** Named in the question, so the reader confirms an AMOUNT rather than a button. */
  readonly amount: string;
  readonly currency: string;
  /** The last four of the account the transfer came from, or null where none is recorded. */
  readonly sourceLast4: string | null;
}) {
  const router = useRouter();
  const c = t.sections.bookingDetail;
  const { ask, dialog } = useConfirm();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsSource = sourceLast4 === null;

  async function settle(form: FormData): Promise<void> {
    if (busy) return;

    const destinationAccount = text(form, 'destinationAccount').trim();
    const transferReference = text(form, 'transferReference').trim();
    const sourceAccount = needsSource ? text(form, 'sourceAccount').trim() : undefined;
    const last4 = sourceLast4 ?? normaliseBankAccount(destinationAccount).slice(-4);

    const confirmed = await ask({
      title: c.settleTitle,
      message: fill(c.settleMessage, { amount, currency, last4: ltrIsolate(last4) }),
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
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            destinationAccount,
            transferReference,
            ...(sourceAccount ? { sourceAccount } : {}),
          }),
        },
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
      setOpen(false);
      router.refresh();
    } catch {
      setError(c.settleUnreachable);
    } finally {
      setBusy(false);
    }
  }

  const field =
    'field-ltr rounded-lg border border-line bg-field px-3 py-2 text-14 text-text disabled:cursor-not-allowed';

  return (
    <div className="mt-2 grid gap-2">
      <button
        type="button"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen(!open)}
        className="min-h-10 w-fit cursor-pointer rounded-lg border border-gold/50 px-3 py-1.5 text-13 font-bold text-gold-read transition-transform duration-150 ease-out-strong active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none lg:min-h-0"
      >
        {busy ? c.settleWorking : c.settleAction}
      </button>

      {open ? (
        <form
          className="grid gap-2 rounded-lg border border-gold/30 bg-gold/[0.06] p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void settle(new FormData(event.currentTarget));
          }}
        >
          <p className="text-13 text-gold-read">
            {needsSource
              ? c.settleNoSource
              : fill(c.settleExpected, { last4: ltrIsolate(sourceLast4) })}
          </p>

          {needsSource ? (
            <label className="grid gap-1">
              <span className="text-13 text-faint">{c.settleSourceLabel}</span>
              <input
                name="sourceAccount"
                required
                minLength={6}
                maxLength={80}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                className={field}
              />
            </label>
          ) : null}

          <label className="grid gap-1">
            <span className="text-13 text-faint">{c.settleDestinationLabel}</span>
            <input
              name="destinationAccount"
              required
              minLength={6}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              className={field}
            />
            <span className="text-13 text-faint">{c.settleAccountHint}</span>
          </label>

          <label className="grid gap-1">
            <span className="text-13 text-faint">{c.settleReferenceLabel}</span>
            <input
              name="transferReference"
              required
              minLength={3}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              className={field}
            />
            <span className="text-13 text-faint">{c.settleReferenceHint}</span>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg border border-gold/50 px-4 py-2 text-14 font-bold text-gold-read hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
          >
            {busy ? c.settleWorking : c.settleSubmit}
          </button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="text-13 text-bad">
          {error}
        </p>
      ) : null}

      {dialog}
    </div>
  );
}
