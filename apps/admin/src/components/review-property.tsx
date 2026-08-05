'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@/lib/strings';

/**
 * Publish or reject a listing (§8.1, P-002).
 *
 * Approving publishes immediately — the SRS treats verification and going live as one
 * decision, so there is no intermediate "approved but invisible" state for a listing
 * to get lost in. The button therefore says what it does.
 *
 * Two preconditions are surfaced rather than discovered on submit: the partner must
 * be verified (item 116, which the API enforces) and the listing needs at least one
 * unit (nothing bookable otherwise). Both are checked server-side too; this is so a
 * reviewer sees them before writing notes.
 */
export function ReviewProperty({
  reference,
  partnerVerified,
  hasUnits,
}: {
  reference: string;
  partnerVerified: boolean;
  hasUnits: boolean;
}) {
  const router = useRouter();

  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canApprove = partnerVerified && hasUnits;

  async function submit(decision: 'approve' | 'reject', notes: string) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/properties/${reference}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(messageOf(body) ?? 'Could not record that decision.');
        setBusy(false);
        return;
      }

      router.refresh();
      setBusy(false);
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-card p-4">
      {!canApprove ? (
        <p className="mb-3 rounded border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-gold">
          {!partnerVerified
            ? 'The partner must be verified before this listing can be published.'
            : 'This listing has no units, so nothing could be booked.'}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mb-3 text-xs text-bad">
          {error}
        </p>
      ) : null}

      {mode === 'idle' ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canApprove}
            onClick={() => setMode('approve')}
            className="cursor-pointer rounded-lg bg-ok px-4 py-2 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t.sections.reviewProperty.approveAndPublish}
          </button>
          <button
            type="button"
            onClick={() => setMode('reject')}
            className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm text-muted hover:border-bad/50 hover:text-bad"
          >
            {t.sections.reviewProperty.reject}
          </button>
        </div>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get('notes');
            void submit(mode, typeof value === 'string' ? value : '');
          }}
        >
          <label htmlFor="property-notes" className="text-xs text-muted">
            {mode === 'approve'
              ? 'Notes (optional). Publishing makes this listing searchable immediately.'
              : 'What must the partner change? Required, and they see it.'}
          </label>
          <textarea
            id="property-notes"
            name="notes"
            rows={3}
            required={mode === 'reject'}
            className="rounded-lg border border-line bg-field px-3 py-2 text-sm text-text"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60 ${
                mode === 'approve' ? 'bg-ok' : 'bg-bad'
              }`}
            >
              {busy
                ? 'Saving…'
                : mode === 'approve'
                  ? 'Publish now'
                  : 'Confirm rejection'}
            </button>
            <button
              type="button"
              onClick={() => setMode('idle')}
              className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm text-muted"
            >
              {t.sections.settings.cancel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function messageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;

  const { message } = body;
  return typeof message === 'string' ? message : null;
}
