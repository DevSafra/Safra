'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { PartnerDocument } from '@/lib/api';
import { fill, label, t } from '@/lib/strings';
import { StatusPill } from '@/components/admin-table';
import { statusTone } from '@/lib/status-tone';

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
          <p className="text-sm text-text">
            {label(t.enums.documentKind, document.kind)}
          </p>
          <p className="truncate text-xs text-faint">
            {fill(t.sections.documentReview.fileLine, {
              fileName: document.fileName,
              when: document.createdAt?.slice(0, 10) ?? t.admin.noData,
            })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <StatusPill tone={statusTone(document.status)}>
            {label(t.enums.verification, document.status)}
          </StatusPill>
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
            {t.sections.documentReview.open}
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
            {t.sections.documentReview.rejectHint}
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
              className="cursor-pointer rounded-lg bg-bad px-3 py-1.5 text-xs font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Reject document'}
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs text-muted"
            >
              {t.sections.settings.cancel}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void decide('approve')}
            disabled={busy}
            className="cursor-pointer rounded-lg border border-ok/40 bg-ok/10 px-3 py-1.5 text-xs text-ok disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {t.sections.documentReview.approve}
          </button>
          <button
            type="button"
            onClick={() => setRejecting(true)}
            disabled={busy}
            className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-bad/50 hover:text-bad disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {t.sections.documentReview.reject}
          </button>
        </div>
      )}
    </div>
  );
}

function messageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;

  const { message } = body;
  return typeof message === 'string' ? message : null;
}
