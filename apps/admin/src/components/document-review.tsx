'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { PartnerDocument } from '@/lib/api';

/**
 * One document, with its own approve/reject (§8.1, item 121).
 *
 * Per document rather than per partner because "your paperwork was rejected" makes a
 * partner guess and re-upload everything. Telling them the ownership proof was
 * illegible while the ID was fine turns three review cycles into one.
 */
export function DocumentReview({ document }: { document: PartnerDocument }) {
  const router = useRouter();

  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'approve' | 'reject', notes?: string) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/documents/${document.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, ...(notes ? { notes } : {}) }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(messageOf(body) ?? 'Could not record that decision.');
        setBusy(false);
        return;
      }

      // The page is a server component, so refresh() is what re-reads the new state.
      setRejecting(false);
      router.refresh();
      setBusy(false);
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }

  const settled = document.status !== 'pending';

  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-text">{kindLabel(document.kind)}</p>
          <p className="truncate text-xs text-faint">
            {document.fileName} · uploaded {document.createdAt?.slice(0, 10) ?? '—'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <StatusPill status={document.status} />
          {/*
            A plain link, not a fetch: the browser's own download handling is what
            makes `Content-Disposition: attachment` do its job. Opening in a new tab
            keeps the reviewer's place in the application.
          */}
          <a
            href={`/api/documents/${document.id}/file`}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-gold/50 hover:text-gold"
          >
            Open
          </a>
        </div>
      </div>

      {document.reviewNotes ? (
        <p className="mt-3 rounded border border-line bg-field px-3 py-2 text-xs text-muted">
          {document.reviewNotes}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-xs text-bad">
          {error}
        </p>
      ) : null}

      {settled ? null : rejecting ? (
        <form
          className="mt-3 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get('notes');
            void decide('reject', typeof value === 'string' ? value : '');
          }}
        >
          <label htmlFor={`notes-${document.id}`} className="text-xs text-muted">
            What is wrong with it? The partner sees this.
          </label>
          <textarea
            id={`notes-${document.id}`}
            name="notes"
            required
            minLength={1}
            rows={2}
            className="rounded-lg border border-line bg-field px-3 py-2 text-sm text-text"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-bad px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Reject document'}
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void decide('approve')}
            disabled={busy}
            className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-1.5 text-xs text-ok disabled:opacity-60"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => setRejecting(true)}
            disabled={busy}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-bad/50 hover:text-bad disabled:opacity-60"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    identity: 'Identity document',
    commercial_register: 'Commercial register',
    ownership_proof: 'Proof of ownership',
    management_contract: 'Management contract',
    bank_confirmation: 'Bank confirmation',
  };

  return labels[kind] ?? kind.replace(/_/g, ' ');
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'approved'
      ? 'border-ok/40 bg-ok/10 text-ok'
      : status === 'rejected'
        ? 'border-bad/40 bg-bad/10 text-bad'
        : 'border-line bg-field text-faint';

  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs ${tone}`}>{status}</span>
  );
}

function messageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;

  const { message } = body;
  return typeof message === 'string' ? message : null;
}
