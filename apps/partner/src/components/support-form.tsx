'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { isErrorCode } from '@safra/contracts';
import { errorMessage } from '@safra/i18n';

import { t } from '@/lib/strings';

/**
 * الدعم's write, for a partner: opening a request and replying to one.
 *
 * A sibling of the customer app's `SupportForm` rather than a shared component, because the two differ in
 * everything except shape — different endpoints, different copy source (this app has one language and
 * reads `t` directly), different styling tokens. What they DO share is the rule they enforce, and that
 * lives in `supportOpenSchema`, which both proxies validate against.
 *
 * ## The hint is not decoration
 *
 * Contact details are redacted on the way IN and the original is never kept, so a partner who writes
 * "call me on 0955…" is not merely ignored — the number is gone. Before they type is the only honest
 * place to say so.
 */
export function SupportForm({ reference }: { readonly reference?: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpoint = reference
    ? `/api/support/${encodeURIComponent(reference)}/reply`
    : '/api/support';

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
        setError(isErrorCode(code) ? errorMessage(code, 'ar') : t.support.failed);

        return;
      }

      setBody('');

      if (reference) {
        router.refresh();
      } else {
        const created = payload as { reference?: string } | null;

        router.push(created?.reference ? `/support/${created.reference}` : '/support');
        router.refresh();
      }
    } catch {
      setBusy(false);
      setError(t.support.failed);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-3">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-[12.5px] text-bad"
        >
          {error}
        </p>
      ) : null}

      <label className="grid gap-1">
        <span className="text-[12.5px] text-muted">
          {reference ? t.support.replyLabel : t.support.bodyLabel}
        </span>
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
        <span className="text-[11px] text-faint">{t.support.bodyHint}</span>
      </label>

      <button
        type="submit"
        disabled={busy}
        className="min-h-10 w-fit cursor-pointer rounded-lg bg-gold px-5 text-[12.5px] font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 lg:py-2"
      >
        {busy
          ? t.support.submitting
          : reference
            ? t.support.replySubmit
            : t.support.submit}
      </button>
    </form>
  );
}
