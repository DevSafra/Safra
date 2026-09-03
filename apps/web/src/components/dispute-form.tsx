'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { isErrorCode } from '@safra/contracts';
import { errorMessage, errorParams, type Locale } from '@safra/i18n';

/**
 * Raising a dispute.
 *
 * ## Why the booking is a SELECT and not a text field
 *
 * A reference typed by hand is a reference typed wrongly, and the failure would be a 404 that reads
 * as "we cannot find your booking" to somebody holding it in their other hand. The options come from
 * the API's own answer to "which of your bookings could be disputed", so the picker and the rule that
 * enforces it cannot disagree.
 *
 * ## The consequence is stated before the button, not after
 *
 * Opening a dispute holds the host's payout for that booking until it is settled. That is the right
 * behaviour and it is also a serious thing to do to somebody, so the page says so in `intro` above
 * this form. A person should know what they are setting in motion while they can still choose not to.
 *
 * ## Copy is passed in
 *
 * Same shape as `SupportForm` and `SupportClose` in this app: the page resolves the catalogue on the
 * server and hands down strings, so no client component reaches for a translator and no sentence is
 * written here.
 */
export function DisputeForm({
  locale,
  bookings,
  reasons,
  labels,
}: {
  readonly locale: Locale;
  readonly bookings: readonly {
    readonly reference: string;
    readonly property: string | null;
    readonly checkIn: string;
  }[];
  /** The four `dispute_kind` values with their labels, in the reader's language. */
  readonly reasons: readonly { readonly value: string; readonly label: string }[];
  readonly labels: {
    readonly booking: string;
    readonly reason: string;
    readonly subject: string;
    readonly body: string;
    readonly bodyHint: string;
    readonly submit: string;
    readonly submitting: string;
    readonly failed: string;
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy) return;

    /*
      `FormData.get` returns `File | string | null`, and `String(aFile)` is `[object File]`. Narrowing
      is the difference between a validation error nobody can explain and a type error at build time.
    */
    const form = new FormData(event.currentTarget);
    const field = (name: string): string => {
      const value = form.get(name);

      return typeof value === 'string' ? value : '';
    };

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/${locale}/api/account/disputes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingReference: field('bookingReference'),
          kind: field('kind'),
          title: field('title'),
          description: field('description'),
        }),
      });

      const payload: unknown = await response.json().catch(() => null);

      setBusy(false);

      if (!response.ok) {
        const code =
          payload && typeof payload === 'object' && 'code' in payload
            ? String(payload.code)
            : '';

        /* Only OUR codes are translated: an error body must not become a way to print chosen text. */
        setError(
          isErrorCode(code)
            ? errorMessage(code, locale, errorParams(payload))
            : labels.failed,
        );

        return;
      }

      /* Server-rendered list: the new row arrives by refetching rather than by local state. */
      router.refresh();
    } catch {
      setBusy(false);
      setError(labels.failed);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-4">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {error}
        </p>
      ) : null}

      <label className="grid gap-1.5">
        <span className="text-sm text-muted">{labels.booking}</span>
        <select
          name="bookingReference"
          required
          className="rounded-lg border border-line bg-field px-3 py-2.5 text-text"
        >
          {bookings.map((booking) => (
            <option key={booking.reference} value={booking.reference}>
              {/* The reference is the thing they can match against their voucher, so it leads. */}
              {booking.reference}
              {booking.property ? ` — ${booking.property}` : ''} ({booking.checkIn})
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm text-muted">{labels.reason}</span>
        <select
          name="kind"
          required
          className="rounded-lg border border-line bg-field px-3 py-2.5 text-text"
        >
          {reasons.map((reason) => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm text-muted">{labels.subject}</span>
        <input
          name="title"
          required
          minLength={4}
          maxLength={120}
          className="rounded-lg border border-line bg-field px-3 py-2.5 text-text"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm text-muted">{labels.body}</span>
        <textarea
          name="description"
          rows={5}
          required
          minLength={20}
          maxLength={4000}
          className="rounded-lg border border-line bg-field px-3 py-2.5 text-text"
        />
        <span className="text-xs text-faint">{labels.bodyHint}</span>
      </label>

      <button
        type="submit"
        disabled={busy}
        className="mt-2 inline-flex min-h-10 w-fit cursor-pointer items-center rounded-lg btn-gold px-5 font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 lg:py-2.5"
      >
        {busy ? labels.submitting : labels.submit}
      </button>
    </form>
  );
}
