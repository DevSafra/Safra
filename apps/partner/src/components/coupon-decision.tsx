'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ERROR } from '@safra/contracts';
import { useConfirm } from '@safra/ui';

import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { t } from '@/lib/strings';

/**
 * «قبول» and «رفض» on one offered coupon.
 *
 * ## The warning is the point of this component
 *
 * Bashar (2026-09-01): acceptance is permanent, and the partner must actively confirm after seeing
 * that said. So the sentence appears twice — on the card, where somebody scanning the list reads
 * it, and inside the confirmation, where somebody who skimmed the card cannot avoid it. The dialog
 * is `tone: 'danger'`, which puts the initial focus on «إلغاء»: a partner pressing Enter out of
 * habit declines rather than commits.
 *
 * Rejecting is confirmed too, but plainly. It is reversible in the only sense that matters — SAFRA
 * can offer the coupon again — so it does not need a warning, and giving it one would teach the
 * reader that both dialogs are noise.
 */
export function CouponDecision({ code }: { readonly code: string }) {
  const router = useRouter();
  const c = t.coupons;
  const { ask, dialog } = useConfirm();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'accepted' | 'rejected'): Promise<void> {
    const go = await ask(
      decision === 'accepted'
        ? {
            title: c.confirmTitle,
            message: c.confirmBody,
            confirmLabel: c.accept,
            cancelLabel: t.dialog.cancel,
            /* Red, and the focus starts on «إلغاء» — this one cannot be undone. */
            tone: 'danger',
          }
        : {
            title: c.rejectTitle,
            message: c.rejectBody,
            confirmLabel: c.reject,
            cancelLabel: t.dialog.cancel,
          },
    );

    if (!go) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/coupons/${encodeURIComponent(code)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });

      if (!response.ok) {
        /*
          «Already decided» is the one refusal worth naming: it is what a partner meets if they
          press twice, or come back to a stale tab after answering on another device. Everything
          else falls through to one sentence — a partner cannot act on a validation code.
        */
        const code = await codeOfResponse(response);

        /*
          A SUSPENDED partner is told why, before this component's own vocabulary.

          `refusalFor` answers only for the codes it knows — suspension today — and null for
          everything else, so it is strictly additive. Without it a suspended partner pressing
          «قبول» would read «تعذّر حفظ قرارك», a generic failure for a state whose reason is on
          the same screen.
        */
        setError(
          refusalFor(code) ??
            (code === ERROR.COUPON_ALREADY_DECIDED ? c.alreadyDecided : c.failed),
        );

        return;
      }

      router.refresh();
    } catch {
      setError(c.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      {/* Said on the card as well as in the dialog — see the note above. */}
      <p className="text-[11.5px] leading-relaxed text-bad">{c.warning}</p>

      {error ? <p className="text-[11.5px] font-semibold text-bad">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          data-coupon-accept={code}
          onClick={() => void decide('accepted')}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-gold px-4 py-2 text-xs font-bold text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
        >
          {busy ? c.accepting : c.accept}
        </button>
        <button
          type="button"
          disabled={busy}
          data-coupon-reject={code}
          onClick={() => void decide('rejected')}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-4 py-2 text-xs font-bold text-muted transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
        >
          {c.reject}
        </button>
      </div>

      {dialog}
    </div>
  );
}
