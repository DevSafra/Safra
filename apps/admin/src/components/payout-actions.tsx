'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { apiErrorOf, t } from '@/lib/strings';

type Action = 'close' | 'release' | 'paid' | 'hold' | 'lift-hold' | 'cancel';

/**
 * The staff payout controls (§9.3).
 *
 * ## What is offered depends on the state, and that is enforced twice
 *
 * The buttons shown are the transitions that make sense from where the payout is, but this
 * component is not what makes them safe: `PayoutService` refuses an out-of-order transition on its
 * own authority, and the database refuses a state whose evidence does not match it. Hiding a button
 * is a courtesy to the operator, not a control.
 *
 * ## Why marking paid says so plainly
 *
 * It is the only irreversible one. A paid payout is immutable by trigger — `deny_paid_payout_
 * mutation` refuses to restate it — so the confirmation names that rather than asking a generic
 * "are you sure". Somebody clicking through a dialog they have seen fifty times deserves to be
 * told which of the fifty this one is.
 */
export function PayoutActions({
  id,
  status,
}: {
  readonly id: string;
  readonly status: string;
}) {
  const router = useRouter();

  const [open, setOpen] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: Action, body: Record<string, string> | null) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/payouts/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });

      if (!response.ok) {
        /*
          The REASON, not «تعذّر تنفيذ الإجراء».

          This branch read `payouts.failed` for every refusal, and the six controls above can be
          refused eleven distinct ways — the payout is not releasable, its net is zero, it is frozen
          by an open dispute, it is frozen because the PARTNER IS SUSPENDED, the partner is not
          sanctions-screened, it is already paid, already final, not held, not scheduled, not
          accruing, or gone. `proxy` has always forwarded the API's `code`; this component was
          throwing it away, so eleven precise sentences that exist in three languages arrived as one
          vague one and the operator's only move was to guess or to ask an engineer.

          `PAYOUT_FROZEN_BY_SUSPENSION` is the sharpest case and the reason this changed now: it is
          thrown ONLY behind this release control, so before this line it was an error code no human
          could ever read — the enforcement policy's payout freeze had no surface at all.

          `apiErrorOf` rather than `apiError`: it reads `code` and falls back to `message`, which is
          what the BFF route above sends when it refuses a malformed body before the API is called.
        */
        setError(apiErrorOf(await response.json().catch(() => null)));
        setBusy(false);
        return;
      }

      router.refresh();
      setOpen(null);
      setBusy(false);
    } catch {
      setError(t.sections.payouts.unreachable);
      setBusy(false);
    }
  }

  /* A paid payout is history. There is nothing left to decide, and the screen says so. */
  if (status === 'paid' || status === 'cancelled') {
    return <p className="text-[12.5px] text-faint">{t.sections.payouts.noActions}</p>;
  }

  return (
    <div className="grid gap-3">
      {error ? (
        <p role="alert" className="text-[12.5px] text-bad">
          {error}
        </p>
      ) : null}

      {open === null ? (
        <div className="flex flex-wrap gap-2">
          {status === 'accruing' ? (
            <Button
              onClick={() => setOpen('close')}
              label={t.sections.payouts.close}
              hint={t.sections.payouts.closeHint}
            />
          ) : null}

          {status === 'pending_release' ? (
            <>
              <Button
                onClick={() => setOpen('release')}
                label={t.sections.payouts.release}
                hint={t.sections.payouts.releaseHint}
                primary
              />
              <Button
                onClick={() => setOpen('hold')}
                label={t.sections.payouts.hold}
                hint={t.sections.payouts.holdHint}
              />
            </>
          ) : null}

          {status === 'on_hold' ? (
            <Button
              onClick={() => void submit('lift-hold', null)}
              label={t.sections.payouts.liftHold}
              hint={t.sections.payouts.holdHint}
            />
          ) : null}

          {status === 'scheduled' ? (
            <>
              <Button
                onClick={() => setOpen('paid')}
                label={t.sections.payouts.markPaid}
                hint={t.sections.payouts.markPaidHint}
                primary
              />
              {/*
                A way BACK from scheduled (Bashar, 2026-09-04).

                This screen offered «تسجيل الدفع» and nothing else, so a released payout had exactly
                one exit: pay it. `PayoutService.hold` has always accepted a scheduled payout — the
                control simply had no form to click, which is the shape this project keeps finding.

                It stopped being cosmetic when release began recording a verified destination. A
                payout can now be scheduled and then have its account edited back into review, at
                which point marking it paid refuses — correctly — and without this button the
                operator has no move at all. Holding it clears the date and returns it to the queue
                through «رفع التعليق», which is where somebody can decide what to do.
              */}
              <Button
                onClick={() => setOpen('hold')}
                label={t.sections.payouts.hold}
                hint={t.sections.payouts.holdHint}
              />
            </>
          ) : null}

          {status !== 'scheduled' ? (
            <Button
              onClick={() => setOpen('cancel')}
              label={t.sections.payouts.cancelPayout}
              hint={t.sections.payouts.cancelHint}
              danger
            />
          ) : null}
        </div>
      ) : (
        <form
          className="grid max-w-md gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const value = (name: string): string => {
              const raw = form.get(name);
              return typeof raw === 'string' ? raw.trim() : '';
            };

            if (open === 'release') {
              void submit('release', {
                scheduledFor: value('scheduledFor'),
                ...(value('notes') ? { notes: value('notes') } : {}),
              });
            } else if (open === 'paid') {
              void submit('paid', { paidReference: value('paidReference') });
            } else if (open === 'hold' || open === 'cancel') {
              void submit(open, { reason: value('reason') });
            } else {
              void submit(open, null);
            }
          }}
        >
          <p className="text-[12.5px] leading-relaxed text-muted">{HINTS[open]}</p>

          {open === 'release' ? (
            <>
              <Field
                name="scheduledFor"
                type="date"
                label={t.sections.payouts.releaseDate}
                required
              />
              <Field name="notes" label={t.sections.payouts.releaseNotes} />
            </>
          ) : null}

          {open === 'paid' ? (
            <Field
              name="paidReference"
              label={t.sections.payouts.paidReferenceLabel}
              required
            />
          ) : null}

          {open === 'hold' || open === 'cancel' ? (
            <Field name="reason" label={t.sections.payouts.reason} required />
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="min-h-10 cursor-pointer rounded-lg bg-gold px-4 py-2 text-[12.5px] font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
            >
              {busy ? t.sections.payouts.working : t.sections.payouts.confirm}
            </button>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="min-h-10 cursor-pointer rounded-lg border border-line px-4 py-2 text-[12.5px] text-muted lg:min-h-0"
            >
              {t.sections.payouts.cancel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** What each confirmation step tells the operator it is about to do. */
const HINTS: Record<Action, string> = {
  close: t.sections.payouts.closeHint,
  release: t.sections.payouts.releaseHint,
  paid: t.sections.payouts.markPaidHint,
  hold: t.sections.payouts.holdHint,
  'lift-hold': t.sections.payouts.holdHint,
  cancel: t.sections.payouts.cancelHint,
};

function Button({
  onClick,
  label,
  hint,
  primary,
  danger,
}: {
  readonly onClick: () => void;
  readonly label: string;
  readonly hint: string;
  readonly primary?: boolean;
  readonly danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={`min-h-10 cursor-pointer rounded-lg px-4 py-2 text-[12.5px] font-semibold lg:min-h-0 ${
        primary
          ? 'bg-gold text-bg'
          : danger
            ? 'border border-bad/50 text-bad'
            : 'border border-line text-muted'
      }`}
    >
      {label}
    </button>
  );
}

function Field({
  name,
  label,
  type = 'text',
  required,
}: {
  readonly name: string;
  readonly label: string;
  readonly type?: string;
  readonly required?: boolean;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[11.5px] text-faint">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text lg:min-h-0"
      />
    </label>
  );
}
