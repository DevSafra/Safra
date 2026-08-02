'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The approve/reject decision (§8.1).
 *
 * Approval is disabled until screening is recorded, mirroring the API's own refusal
 * rather than replacing it. Doing it in both places is deliberate: the API is the
 * control, and this is so a reviewer learns the requirement before writing their
 * notes rather than after submitting them.
 *
 * Approving publishes nothing by itself, but it UNBLOCKS publication of every
 * listing this partner has submitted (item 116) — so the confirmation says so.
 */
export function VerifyPartner({
  reference,
  screened,
}: {
  reference: string;
  screened: boolean;
}) {
  const router = useRouter();

  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: 'approve' | 'reject', notes: string) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/partners/${reference}/verify`, {
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
      {!screened ? (
        <p className="mb-3 rounded border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-gold">
          Record a sanctions screening result before approving. Verifying an unscreened
          counterparty is a legal risk for the German entity, not a formality.
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
            disabled={!screened}
            onClick={() => setMode('approve')}
            title={screened ? undefined : 'Sanctions screening is required first.'}
            className="rounded-lg bg-good px-4 py-2 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-40"
          >
            Approve partner
          </button>
          <button
            type="button"
            onClick={() => setMode('reject')}
            className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:border-bad/50 hover:text-bad"
          >
            Reject application
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
          <label htmlFor="decision-notes" className="text-xs text-muted">
            {mode === 'approve'
              ? 'Notes (optional). Approving lets this partner’s submitted listings be published.'
              : 'Why is this being rejected? Required, and the partner sees it.'}
          </label>
          <textarea
            id="decision-notes"
            name="notes"
            rows={3}
            required={mode === 'reject'}
            className="rounded-lg border border-line bg-field px-3 py-2 text-sm text-text"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-bg disabled:opacity-60 ${
                mode === 'approve' ? 'bg-good' : 'bg-bad'
              }`}
            >
              {busy
                ? 'Saving…'
                : mode === 'approve'
                  ? 'Confirm approval'
                  : 'Confirm rejection'}
            </button>
            <button
              type="button"
              onClick={() => setMode('idle')}
              className="rounded-lg border border-line px-4 py-2 text-sm text-muted"
            >
              Cancel
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
