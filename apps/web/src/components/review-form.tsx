'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * The customer's review form (§7.3, P-006).
 *
 * ## What it deliberately does not offer
 *
 * No edit and no delete, and the rule is printed above the submit button. A review is frozen the
 * moment it is written — `rating` and `body` are immutable by database trigger — so a form that
 * suggested otherwise would be promising something the system refuses. Saying it BEFORE submission
 * is the point: afterwards it is an explanation, before it is a chance to word it carefully.
 *
 * ## Every rule is enforced server-side regardless
 *
 * That the booking is theirs, that the stay finished, that they have not already reviewed it —
 * none of that is decided here. This form is reached only when the API said the booking was
 * eligible, and the API says so again on submission. The screen is a convenience over a control.
 */
export function ReviewForm({
  bookingReference,
  locale,
}: {
  readonly bookingReference: string;
  readonly locale: string;
}) {
  const t = useTranslations('reviews');
  const router = useRouter();

  const [rating, setRating] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(body: string) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/${locale}/api/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingReference, rating, body: body.trim() }),
      });

      if (!response.ok) {
        setError(t('failed'));
        setBusy(false);
        return;
      }

      /* The page re-reads eligibility and renders the review that now exists. */
      router.refresh();
      setBusy(false);
    } catch {
      setError(t('unreachable'));
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-4 grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const raw = new FormData(event.currentTarget).get('body');
        void submit(typeof raw === 'string' ? raw : '');
      }}
    >
      {error ? (
        <p
          role="alert"
          className="rounded-card border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {error}
        </p>
      ) : null}

      {/*
        A radio GROUP, not five buttons.

        Stars are the obvious drawing and a radio group is the honest markup: a screen reader
        announces "3 of 5, radio" rather than a row of unlabelled glyphs, and the keyboard arrows
        work without any script. The star is decoration layered on top and is `aria-hidden`.
      */}
      <fieldset>
        <legend className="text-sm text-muted">{t('ratingLabel')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <label
              key={value}
              className={`inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors ${
                rating === value
                  ? 'border-gold bg-gold/15 font-bold text-gold'
                  : 'border-line text-muted hover:border-gold/40'
              }`}
            >
              <input
                type="radio"
                name="rating"
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                className="sr-only"
              />
              <span aria-hidden>★</span>
              {value}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="grid gap-1.5">
        <span className="text-sm text-muted">{t('bodyLabel')}</span>
        <textarea
          name="body"
          rows={5}
          required
          minLength={3}
          maxLength={2000}
          className="rounded-card border border-line bg-card px-3 py-2.5 text-sm text-text"
        />
        <span className="text-xs text-faint">{t('bodyHint')}</span>
      </label>

      {/* P-006, said before it matters rather than after. */}
      <p className="rounded-card border border-dashed border-line px-3 py-2 text-xs leading-relaxed text-faint">
        {t('rule')}
      </p>

      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-10 w-fit items-center rounded-lg bg-gold px-5 py-2.5 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
