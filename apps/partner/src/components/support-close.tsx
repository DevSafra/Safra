'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { isErrorCode } from '@safra/contracts';
import { errorMessage, errorParams } from '@safra/i18n';

import { t } from '@/lib/strings';

/**
 * "I no longer need help" — the asker ending their own thread.
 *
 * ## Why this is a separate component from `SupportForm`
 *
 * They are on the same page and do opposite things. The form is the reason to keep a thread going; this
 * ends it. Folding a destructive-ish action into a component whose job is "send a message" would put a
 * second submit inside one `<form>`, where the Enter key means whichever the browser picks.
 *
 * ## A form POST rather than a link
 *
 * Closing WRITES. A `<Link>` or a bare `<a>` would let a prefetch, a crawler or a pasted URL end
 * somebody's support request — the same reasoning that turned the rows-per-page bar from a GET into a
 * POST. It is a button inside its own form, so it is a POST by construction.
 *
 * ## No confirmation dialogue
 *
 * Deliberate. The action is reversible in the way that matters — opening a new request is one press —
 * and the thread stays readable afterwards, so nothing is lost. A confirm step for something this
 * recoverable trains people to dismiss confirmations, which is what makes the destructive ones dangerous.
 */
export function SupportClose({ reference }: { readonly reference: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/support/${encodeURIComponent(reference)}/close`,
        { method: 'POST' },
      );

      setBusy(false);

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const code =
          payload && typeof payload === 'object' && 'code' in payload
            ? String(payload.code)
            : '';

        /* Only OUR codes are translated — an error body must not become a way to print chosen text. */
        setError(
          isErrorCode(code)
            ? errorMessage(code, 'ar', errorParams(payload))
            : t.support.closeFailed,
        );

        return;
      }

      /* The page is server-rendered, so the closed state arrives by refetching rather than by state. */
      router.refresh();
    } catch {
      setBusy(false);
      setError(t.support.closeFailed);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-2">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-[12.5px] text-bad"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="min-h-10 w-fit cursor-pointer rounded-lg border border-line px-5 text-[12.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 lg:py-2"
      >
        {busy ? t.support.closeSubmitting : t.support.closeLabel}
      </button>

      <span className="text-[11px] text-faint">{t.support.closeHint}</span>
    </form>
  );
}
