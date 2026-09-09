'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useConfirm } from '@safra/ui';

import { t, apiErrorOf } from '@/lib/strings';

/**
 * Sending an undelivered notice again, because a person decided it should go.
 *
 * ## Why the control exists
 *
 * The recovery job re-drives a `failed` notice on its own once the retry schedule can no longer be
 * running. It deliberately leaves `abandoned` alone — attempts exhausted, and a timer that ignored
 * that would loop against a mail server that has already refused five times. Somebody still has to
 * be able to say «the address is fixed, send it»; before 2026-09-09 the only way to say it was an
 * UPDATE against the database.
 *
 * ## Why it asks first
 *
 * A notice is an email to a real partner or guest. `tone: 'danger'` is not used — nothing is
 * destroyed — but a confirmation is, because the action is not undoable and the reader may have
 * clicked the wrong row in a table of a thousand.
 */
export function NotificationRedrive({
  id,
  status,
}: {
  readonly id: string;
  readonly status: string;
}) {
  const router = useRouter();
  const c = t.sections.comms;
  const { ask, dialog } = useConfirm();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(): Promise<void> {
    const confirmed = await ask({
      title: c.redriveTitle,
      message: status === 'abandoned' ? c.redriveAbandonedAsk : c.redriveAsk,
      confirmLabel: c.redriveConfirm,
      cancelLabel: t.sections.dialog.cancel,
    });

    if (!confirmed) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/notifications/${encodeURIComponent(id)}/redrive`,
        {
          method: 'POST',
        },
      );

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setError(apiErrorOf(payload));

        return;
      }

      /*
        The outcome, not just «done». A notice whose subject has been archived cannot be rebuilt at
        all, and the API says so rather than pretending — reporting success for a mail that was
        never enqueued is the shape this whole finding is about.
      */
      const body: unknown = await response.json().catch(() => null);
      const outcome =
        typeof body === 'object' && body !== null && 'outcome' in body
          ? String(body.outcome)
          : '';

      if (outcome === 'unreconstructable') {
        setError(c.redriveUnreconstructable);

        return;
      }

      setDone(true);
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-1">
      <button
        type="button"
        disabled={busy || done}
        onClick={() => void submit()}
        className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.4)] px-2.5 py-1 text-[13px] font-bold text-gold-read transition-colors hover:bg-[rgba(var(--goldA),0.08)] disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
      >
        {busy ? t.table.working : done ? c.redriveQueued : c.redrive}
      </button>
      {error ? <span className="text-[14px] text-bad">{error}</span> : null}
      {dialog}
    </div>
  );
}
