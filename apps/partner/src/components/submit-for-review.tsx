'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useConfirm } from '@safra/ui';
import { ERROR } from '@safra/contracts';
import { errorMessage } from '@safra/i18n';

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
  hasLocation,
}: {
  readonly reference: string;
  readonly status: string;
  /** Zero is a real, common state — 991 listings had it. It disables, it does not hide. */
  readonly unitCount: number;
  /**
   * Whether the listing has been placed on the map.
   *
   * Same treatment as `unitCount`, and for the same reason: 97% of the catalogue is unplaced, so
   * this is the COMMON state rather than an edge one. It disables the button and says why, rather
   * than hiding a step the partner then cannot find.
   */
  readonly hasLocation: boolean;
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
        const code = await codeOfResponse(response);

        setMessage({
          kind: 'bad',
          text: refusalFor(code) ?? readinessRefusal(code) ?? t.editProperty.submitFailed,
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
      <h3 className="text-14 font-bold text-text">{t.editProperty.submitTitle}</h3>

      {message ? (
        <p
          role="alert"
          className={`rounded-lg border p-2.5 text-13 ${
            message.kind === 'ok'
              ? 'border-ok/40 bg-ok/10 text-ok'
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
          <p className="text-13 leading-relaxed text-muted">
            {t.editProperty.submitHint}
          </p>

          {unitCount === 0 ? (
            <p className="text-13 leading-relaxed text-warn">
              {t.editProperty.submitNeedsUnit}
            </p>
          ) : null}

          {/*
            Both blockers are shown TOGETHER, never one at a time. A form that reveals its second
            requirement only after the first is met makes somebody return twice, and this one is
            worse than most: fixing the unit and coming back to «now place it on the map» reads as
            the rules having changed. The sentence also answers the objection rather than repeating
            the demand — a guest sees an approximate position, never the address.
          */}
          {!hasLocation ? (
            <p className="text-13 leading-relaxed text-warn">
              {t.editProperty.submitNeedsLocation}
            </p>
          ) : null}

          <button
            type="button"
            disabled={busy || unitCount === 0 || !hasLocation}
            onClick={() => void submit()}
            className="min-h-10 w-fit cursor-pointer rounded-lg border border-gold px-4 py-1.5 text-13 font-bold text-gold-read disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
          >
            {busy ? t.editProperty.submitSending : t.editProperty.submitAction}
          </button>
        </>
      ) : (
        <p className="text-13 leading-relaxed text-muted">
          {status === 'pending_review'
            ? t.editProperty.submitPending
            : t.editProperty.submitPublished}
        </p>
      )}

      {dialog}
    </section>
  );
}

/**
 * The two readiness rules, said as themselves rather than as «تعذّر الإرسال».
 *
 * The button is disabled while either is unmet, so this is the STALE path: a listing placed in
 * another tab and cleared, a form left open across a change, a replayed submit. Rare — and
 * precisely why it must not answer with a generic failure. The screen knows why, the API said why,
 * and «something went wrong» would send somebody to support over a sentence they have already read
 * two inches above the button.
 *
 * `errorMessage(code, 'ar')` rather than the response's own `message`: the API's English prose
 * travels for logs and is never displayed, which `no-raw-error-messages.test.ts` holds everywhere.
 */
function readinessRefusal(code: unknown): string | null {
  if (
    code === ERROR.PROPERTY_LOCATION_REQUIRED ||
    code === ERROR.PROPERTY_UNIT_REQUIRED
  ) {
    return errorMessage(code, 'ar');
  }

  return null;
}
