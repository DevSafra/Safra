'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { isErrorCode } from '@safra/contracts';
import { errorMessage, type Locale } from '@safra/i18n';

/**
 * "I no longer need help" — the customer ending their own support request.
 *
 * ## Why a separate component from `SupportForm`
 *
 * They sit on the same page and do opposite things: one keeps a thread going, the other ends it. Two
 * submits inside one `<form>` would mean the Enter key does whichever the browser prefers.
 *
 * ## A form POST, never a link
 *
 * Closing WRITES. A link would let a prefetch, a crawler or a pasted URL end somebody's support request
 * — the reasoning that turned the rows-per-page bar from a GET into a POST. A button in its own form is
 * a POST by construction.
 *
 * ## The copy is passed in
 *
 * Same shape as `SupportForm` in this app: the page resolves the catalogue server-side and hands down
 * strings, so no client component reaches for a translator and no sentence is written here.
 */
export function SupportClose({
  locale,
  reference,
  labels,
}: {
  readonly locale: Locale;
  readonly reference: string;
  readonly labels: {
    readonly submit: string;
    readonly submitting: string;
    readonly hint: string;
    readonly failed: string;
  };
}) {
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
        `/${locale}/api/account/support/${encodeURIComponent(reference)}/close`,
        { method: 'POST' },
      );

      setBusy(false);

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const code =
          payload && typeof payload === 'object' && 'code' in payload
            ? String(payload.code)
            : '';

        /* Only OUR codes are translated: an error body must not become a way to print chosen text. */
        setError(isErrorCode(code) ? errorMessage(code, locale) : labels.failed);

        return;
      }

      /* The page is server-rendered, so the closed state arrives by refetching rather than by state. */
      router.refresh();
    } catch {
      setBusy(false);
      setError(labels.failed);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-2">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg border border-line px-5 text-sm text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 lg:py-2"
      >
        {busy ? labels.submitting : labels.submit}
      </button>

      <span className="text-xs text-faint">{labels.hint}</span>
    </form>
  );
}
