'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t, apiErrorOf } from '@/lib/strings';

/**
 * «استلام» — taking a dispute, which is what brings the sidebar badge down.
 *
 * ## What Bashar asked for, and why it is not a "read" flag
 *
 * 2026-08-27: a control on every dispute that decreases the badge. The tempting shape — mark it
 * seen and stop counting it — would hide a dispute that still FREEZES THE PARTNER'S PAYOUT: the
 * console would report nobody waiting while the money stays held.
 *
 * So this writes the `investigating` status that already existed for exactly this and had no writer
 * at all. Nothing about the money changes — the payout stays frozen, «مستحقات مجمّدة» still counts
 * it, and the queue still sorts it to the top by age. The badge counts what NOBODY HAS TAKEN, so
 * taking one is what makes the number go down.
 *
 * ## Offered only where it means something
 *
 * `open` only. A dispute already under review has been taken, and one that is closed is finished —
 * a button that reports success while changing nothing is the shape this console keeps producing.
 * The API refuses both regardless; a disabled control is a courtesy, the endpoint is the control.
 */
export function AcknowledgeDisputeButton({ reference }: { reference: string }) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function take(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/disputes/${encodeURIComponent(reference)}/acknowledge`,
        { method: 'POST' },
      );

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      /*
        Re-reads the row AND the sidebar, which is the point: both are server-rendered, so the pill
        becomes «قيد المراجعة» and the badge drops in the same paint. Without this the operator
        presses a button, sees nothing move, and presses it again.
      */
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void take()}
        className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-3.5 py-1.5 text-[11.5px] font-bold text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
      >
        {busy ? t.sections.disputes.acknowledging : t.sections.disputes.acknowledge}
      </button>
      {error ? <span className="text-[11px] font-semibold text-bad">{error}</span> : null}
    </div>
  );
}
