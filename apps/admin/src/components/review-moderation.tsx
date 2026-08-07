'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { t } from '@/lib/strings';

/**
 * The staff decision on a reported review (§7.3, P-006).
 *
 * ## Two decisions, and neither is "delete"
 *
 * «إخفاء» takes the review off the listing and out of its average; «إبقاء» leaves it published.
 * The row survives either way — the database refuses `DELETE` on the table — and the note is
 * required in BOTH directions, because a dismissal with no reasoning is the decision a partner is
 * most likely to challenge, and "we looked and disagreed" is a great deal more use to whoever
 * fields that call than an empty field.
 */
export function ReviewModeration({ reference }: { readonly reference: string }) {
  const router = useRouter();

  const [decision, setDecision] = useState<'uphold' | 'dismiss' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(note: string) {
    if (busy || !decision) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/reviews/${encodeURIComponent(reference)}/moderate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, note: note.trim() }),
        },
      );

      if (!response.ok) {
        setError(t.sections.reviewModeration.failed);
        setBusy(false);
        return;
      }

      router.refresh();
      setDecision(null);
      setBusy(false);
    } catch {
      setError(t.sections.reviewModeration.unreachable);
      setBusy(false);
    }
  }

  if (decision) {
    return (
      <form
        className="mt-2 grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const raw = new FormData(event.currentTarget).get('note');
          void submit(typeof raw === 'string' ? raw : '');
        }}
      >
        {decision === 'uphold' ? (
          <p className="text-[11.5px] leading-relaxed text-warn">
            {t.sections.reviewModeration.hiddenEffect}
          </p>
        ) : null}

        <label
          htmlFor={`note-${reference}`}
          className="text-[11.5px] leading-relaxed text-muted"
        >
          {t.sections.reviewModeration.noteLabel}
        </label>
        <textarea
          id={`note-${reference}`}
          name="note"
          rows={2}
          required
          minLength={3}
          className="rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-text"
        />

        {error ? (
          <p role="alert" className="text-[11.5px] text-bad">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="min-h-10 cursor-pointer rounded-lg bg-gold px-4 py-2 text-[12.5px] font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
          >
            {busy
              ? t.sections.reviewModeration.working
              : t.sections.reviewModeration.confirm}
          </button>
          <button
            type="button"
            onClick={() => setDecision(null)}
            className="min-h-10 cursor-pointer rounded-lg border border-line px-4 py-2 text-[12.5px] text-muted lg:min-h-0"
          >
            {t.sections.reviewModeration.cancel}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => setDecision('uphold')}
        className="min-h-10 cursor-pointer rounded-lg border border-bad/50 px-4 py-2 text-[12.5px] font-semibold text-bad lg:min-h-0"
      >
        {t.sections.reviewModeration.uphold}
      </button>
      <button
        type="button"
        onClick={() => setDecision('dismiss')}
        className="min-h-10 cursor-pointer rounded-lg border border-line px-4 py-2 text-[12.5px] text-muted lg:min-h-0"
      >
        {t.sections.reviewModeration.dismiss}
      </button>
    </div>
  );
}
