'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t, apiErrorOf } from '@/lib/strings';

/**
 * Voiding a live card — §9.3's «إلغاء».
 *
 * ## Collapsed, and it asks for a reason
 *
 * The registry's job is to be scannable, so this is a small control per row that opens a reason box
 * rather than a form on every line. The reason is required: this destroys a liability, the audit
 * row is the only record of WHY, and «cancelled by finance» six months later answers nothing.
 *
 * ## Only on a card that can actually be cancelled
 *
 * The page decides — a `used`, `expired` or already-cancelled card gets no control. That is a
 * COURTESY: the API refuses all three, and re-checks expiry against the clock rather than the
 * column, because the hourly sweep may not have reached a card that lapsed forty minutes ago.
 */
export function CancelGiftCardForm({ reference }: { reference: string }) {
  const router = useRouter();
  const c = t.sections.giftcards;

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/gift-cards/${encodeURIComponent(reference)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setError(apiErrorOf(payload));

        return;
      }

      setOpen(false);
      setReason('');
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-10 cursor-pointer rounded-[8px] border border-line px-2.5 py-1 text-[11px] font-bold text-muted transition-colors hover:border-bad hover:text-bad lg:min-h-0"
      >
        {c.cancel}
      </button>
    );
  }

  return (
    <div className="grid gap-1.5">
      <textarea
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
        placeholder={c.cancelReason}
        className="rounded-[8px] border border-line bg-card px-2.5 py-1.5 text-[11.5px] text-text"
      />
      <span className="text-[10.5px] text-faint">{c.cancelReasonHint}</span>

      {error ? <p className="text-[11px] font-semibold text-bad">{error}</p> : null}

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={reason.trim().length < 3 || busy}
          onClick={() => void submit()}
          className="min-h-10 cursor-pointer rounded-[8px] border border-bad px-2.5 py-1 text-[11px] font-bold text-bad disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
        >
          {busy ? t.table.working : c.cancelConfirm}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="min-h-10 cursor-pointer rounded-[8px] border border-line px-2.5 py-1 text-[11px] font-bold text-muted lg:min-h-0"
        >
          {c.cancelBack}
        </button>
      </div>
    </div>
  );
}
