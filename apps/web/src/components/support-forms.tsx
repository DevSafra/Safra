'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { isErrorCode } from '@safra/contracts';
import { errorMessage, errorParams } from '@safra/i18n';

import type { Locale } from '@/i18n/routing';

/**
 * الدعم's two writes: opening a ticket and replying to one.
 *
 * They share a component because they are the same control with a different endpoint — one textarea, one
 * button, one way of reporting a refusal. Splitting them would duplicate the error handling, which is the
 * part with the reasoning in it.
 *
 * ## The hint is not decoration
 *
 * Contact details are redacted on the way IN and the original is never kept, so a customer who writes
 * "call me on 0955…" is not merely ignored — the number is gone. Saying so before they type is the only
 * honest place to say it; afterwards the message already went.
 */
export function SupportForm({
  locale,
  reference,
  labels,
}: {
  readonly locale: Locale;
  /** Absent when opening; present when replying to that ticket. */
  readonly reference?: string;
  readonly labels: {
    readonly field: string;
    readonly hint?: string;
    readonly submit: string;
    readonly submitting: string;
    readonly failed: string;
  };
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpoint = reference
    ? `/${locale}/api/account/support/${encodeURIComponent(reference)}/reply`
    : `/${locale}/api/account/support`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (busy || body.trim() === '') return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });

      const payload: unknown = await response.json().catch(() => null);

      setBusy(false);

      if (!response.ok) {
        const code =
          payload && typeof payload === 'object' && 'code' in payload
            ? String(payload.code)
            : '';

        /* Only OUR codes are translated — an error body must not become a way to print chosen text. */
        setError(
          isErrorCode(code)
            ? errorMessage(code, locale, errorParams(payload))
            : labels.failed,
        );

        return;
      }

      setBody('');

      /*
        A new ticket becomes a thread of its own, so the reader is taken to it. A reply stays where it is
        and the server component re-renders with the new message.
      */
      if (reference) {
        router.refresh();
      } else {
        const created = payload as { reference?: string } | null;

        router.push(
          created?.reference
            ? `/${locale}/account/support/${created.reference}`
            : `/${locale}/account/support`,
        );
        router.refresh();
      }
    } catch {
      setBusy(false);
      setError(labels.failed);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-3">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {error}
        </p>
      ) : null}

      <label className="grid gap-1">
        <span className="text-sm text-muted">{labels.field}</span>
        <textarea
          name="body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={5}
          minLength={10}
          maxLength={4000}
          required
          className="rounded-lg border border-line bg-field px-3 py-2 text-text"
        />
        {labels.hint ? <span className="text-xs text-faint">{labels.hint}</span> : null}
      </label>

      <button
        type="submit"
        disabled={busy}
        className="min-h-10 w-fit cursor-pointer rounded-lg btn-gold px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 lg:py-2.5"
      >
        {busy ? labels.submitting : labels.submit}
      </button>
    </form>
  );
}
