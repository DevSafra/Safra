'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t, apiErrorOf } from '@/lib/strings';

/**
 * «إنهاء المحادثة» — the staff end of a support thread.
 *
 * ## Why a console control existed nowhere
 *
 * `conversations.closed_at` had exactly one writer, `SupportService.close`, and it is asker-only:
 * the customer or partner who opened the ticket could end it and nobody on this side could. So a
 * thread answered on the phone, or one opened twice, stayed open for ever — and «الرسائل» counts
 * open threads with something unread, which is the number an agent works down. The queue could not
 * be emptied by the people whose queue it is.
 *
 * ## Closing is not deleting
 *
 * The messages stay readable, exactly as they do when the asker closes it. Somebody who needs help
 * again opens a new ticket; the record of what was said is not something a console button gets to
 * remove.
 *
 * ## Offered only where it means something
 *
 * A closed thread does not show it — the endpoint answers a second click with «nothing changed»
 * rather than an error, but a button that reports success while changing nothing is the shape this
 * console keeps producing. The API refuses out-of-scope and read-only callers regardless; the
 * control is a courtesy, the endpoint is the control.
 */
export function CloseThreadButton({ reference }: { reference: string }) {
  const router = useRouter();
  const c = t.sections.messages;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function end(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/conversations/${encodeURIComponent(reference)}/close`,
        { method: 'POST' },
      );

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      /*
        Re-reads the thread AND the sidebar: the reply box goes, the notice appears and the badge
        drops in the same paint. Without it the agent presses a button, sees nothing move, and
        presses it again.
      */
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => void end()}
        className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-3.5 py-1.5 text-[11.5px] font-bold text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
      >
        {busy ? c.closingThread : c.closeThread}
      </button>
      <span className="text-[10.5px] text-faint">{c.closeThreadHint}</span>
      {error ? <span className="text-[11px] font-semibold text-bad">{error}</span> : null}
    </div>
  );
}
