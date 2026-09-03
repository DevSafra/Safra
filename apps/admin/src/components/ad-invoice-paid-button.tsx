'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t, apiErrorOf } from '@/lib/strings';

/**
 * «سُدِّدت» — the moment an advertising invoice becomes revenue in the books.
 *
 * ## Why this one asks for a note and the pause button does not
 *
 * Pausing a campaign is reversible and its subject is obvious. This posts a ledger pair that
 * cannot be posted twice and cannot be unposted, and the only record of HOW the money arrived —
 * a transfer reference, a cash receipt — is what the person clicking knows. The note is required
 * by the contract, so an empty one is refused by the API as well as disabled here.
 *
 * The API is the control, not this button: `markPaid` locks the row, re-checks the reader's scope
 * against the campaign's city, and refuses an invoice that is not still `due`. Somebody who
 * deletes the `disabled` attribute reaches a server that answers the same way.
 */
export function AdInvoicePaidButton({ reference }: { readonly reference: string }) {
  const router = useRouter();
  const c = t.sections.adInvoices;

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/ad-invoices/${encodeURIComponent(reference)}/paid`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: note.trim() }),
        },
      );

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setError(apiErrorOf(payload));

        return;
      }

      setOpen(false);
      setNote('');
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-fit cursor-pointer items-center justify-center whitespace-nowrap rounded-lg border border-line px-2.5 py-1 text-[10.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.5)] hover:text-gold"
      >
        {c.markPaid}
      </button>
    );
  }

  return (
    <div className="grid gap-1.5">
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={c.notePlaceholder}
        aria-label={c.note}
        className="rounded-lg border border-line bg-card px-2 py-1 text-[11px] text-text placeholder:text-faint"
      />

      {error ? <span className="text-[10px] font-semibold text-bad">{error}</span> : null}

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={note.trim().length < 3 || busy}
          onClick={() => void submit()}
          className="cursor-pointer rounded-lg border border-[rgba(var(--goldA),0.4)] px-2.5 py-0.5 text-[10.5px] font-bold text-gold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? t.sections.ads.pausing : c.confirm}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="cursor-pointer rounded-lg border border-line px-2.5 py-0.5 text-[10.5px] text-muted"
        >
          {t.sections.ads.cancel}
        </button>
      </div>
    </div>
  );
}
