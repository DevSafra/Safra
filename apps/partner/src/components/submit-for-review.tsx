'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useConfirm } from '@safra/ui';

import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { t } from '@/lib/strings';

/**
 * «إرسال للمراجعة» — the step a partner could not take (Bashar, 2026-09-04).
 *
 * ## The endpoint was complete and nothing called it
 *
 * `POST /partner/properties/:reference/submit` has had its permission, its ownership check, its
 * status guard, its «a listing with no bookable unit cannot be reviewed» refusal, its audit row and
 * its timeline event since the lifecycle was written. There was no control anywhere in the portal.
 * The database said so plainly: **627 drafts, 61 rejected, and not one listing in `pending_review`**
 * — so the console's approval queue had been permanently empty, and a partner who created a listing
 * reached a screen with three buttons (الصور، تعديل، التقويم) and no way forward.
 *
 * ## Every state says something, including the ones with no button
 *
 * A control that is simply absent reads as a missing feature, which is what sent partners to
 * support. `pending_review` and `published` each get their own sentence; a draft with no unit gets
 * the sentence AND keeps the button disabled rather than hidden, because the reader needs to know
 * the step exists before they can understand what is blocking it. The API refuses the same case
 * with `property.unit_required`, so a partner who submits anyway — a tampered `disabled`, a replayed
 * form — meets the identical rule rather than something surprising.
 *
 * ## It asks first
 *
 * Submitting locks the address, and a partner who has not read that will read it here. `useConfirm`
 * rather than `window.confirm` for the reason the standing rule gives: the browser's own dialog
 * shows the origin, cannot be translated, and blocks the thread React renders on.
 */
export function SubmitForReview({
  reference,
  status,
  unitCount,
}: {
  readonly reference: string;
  readonly status: string;
  /** Zero is a real, common state — 991 listings had it. It disables, it does not hide. */
  readonly unitCount: number;
}) {
  const router = useRouter();
  const { ask, dialog } = useConfirm();

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(
    null,
  );

  /* The API's own rule, mirrored so the screen can explain itself before a round trip. */
  const submittable = status === 'draft' || status === 'rejected';

  async function submit() {
    if (busy) return;

    const go = await ask({
      title: t.editProperty.submitConfirmTitle,
      message: t.editProperty.submitConfirmBody,
      confirmLabel: t.dialog.confirm,
      cancelLabel: t.dialog.cancel,
    });

    if (!go) return;

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/properties/${encodeURIComponent(reference)}/submit`,
        { method: 'POST' },
      );

      if (!response.ok) {
        /*
          `refusalFor` first, so «الحساب موقوف» is said as itself rather than falling to this
          screen's generic sentence — the rule `refusal-coverage.test.ts` holds every write to.
        */
        setMessage({
          kind: 'bad',
          text: refusalFor(await codeOfResponse(response)) ?? t.editProperty.submitFailed,
        });
        setBusy(false);

        return;
      }

      setMessage({ kind: 'ok', text: t.editProperty.submitDone });
      setBusy(false);
      router.refresh();
    } catch {
      setMessage({ kind: 'bad', text: t.editProperty.unreachable });
      setBusy(false);
    }
  }

  return (
    <section
      data-submit-review={reference}
      className="grid gap-3 rounded-card border border-line bg-card p-4"
    >
      <h3 className="text-[13px] font-bold text-text">{t.editProperty.submitTitle}</h3>

      {message ? (
        <p
          role="alert"
          className={`rounded-lg border p-2.5 text-[12px] ${
            message.kind === 'ok'
              ? 'border-good/40 bg-good/10 text-good'
              : 'border-bad/40 bg-bad/10 text-bad'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {/*
        The state, in words, whichever it is. `pending_review` and `published` are not failures and
        must not read as them — they are the two outcomes of having done this correctly.
      */}
      {submittable ? (
        <>
          <p className="text-[12px] leading-relaxed text-muted">
            {t.editProperty.submitHint}
          </p>

          {unitCount === 0 ? (
            <p className="text-[12px] leading-relaxed text-warn">
              {t.editProperty.submitNeedsUnit}
            </p>
          ) : null}

          <button
            type="button"
            disabled={busy || unitCount === 0}
            onClick={() => void submit()}
            className="min-h-10 w-fit cursor-pointer rounded-lg border border-gold px-4 py-1.5 text-[12px] font-bold text-gold disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
          >
            {busy ? t.editProperty.submitSending : t.editProperty.submitAction}
          </button>
        </>
      ) : (
        <p className="text-[12px] leading-relaxed text-muted">
          {status === 'pending_review'
            ? t.editProperty.submitPending
            : t.editProperty.submitPublished}
        </p>
      )}

      {dialog}
    </section>
  );
}
