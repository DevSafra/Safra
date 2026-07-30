'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import type { Locale } from '@/i18n/routing';

interface FieldErrors {
  [field: string]: string | undefined;
}

/**
 * Guest details and submit (SRS §6.3 steps 1–4).
 *
 * A client component because it needs three things a plain form cannot give: a
 * stable idempotency key across retries, inline field errors from the API, and a
 * disabled button during submission.
 *
 * §4 allows booking with no account, so nothing here asks the customer to register.
 */
export function CheckoutForm({
  locale,
  unitId,
  checkIn,
  checkOut,
  adults,
  propertySlug,
}: {
  locale: Locale;
  unitId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  propertySlug: string;
}) {
  const t = useTranslations('checkout');
  const router = useRouter();

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  /**
   * Generated ONCE per mounted form, not per submit (EC-003).
   *
   * That is the whole point: if the customer double-clicks, or the network drops and
   * they retry, the same key reaches the API and the second request returns the FIRST
   * booking instead of creating a duplicate. Regenerating it on submit would defeat
   * the protection entirely.
   */
  const [idempotencyKey] = useState(() => `co-${crypto.randomUUID()}`);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);

    try {
      // Posts to our own route handler, not the API directly: that keeps the API
      // origin out of the browser and lets the server attach the real client IP.
      const response = await fetch(`/${locale}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitId,
          checkIn,
          checkOut,
          adults,
          guest: {
            fullName: text(form, 'fullName'),
            email: text(form, 'email'),
            phone: text(form, 'phone'),
          },
          idempotencyKey,
        }),
      });

      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        applyError(body, response.status, { setFormError, setFieldErrors, t });
        return;
      }

      // `'reference' in body` narrows, so no cast is needed to read it.
      const reference =
        typeof body === 'object' && body !== null && 'reference' in body
          ? String(body.reference)
          : null;

      if (!reference) {
        setFormError(t('genericError'));
        return;
      }

      router.push(`/${locale}/booking/${reference}`);
    } catch {
      // A network failure is safe to retry: the idempotency key is unchanged, so a
      // booking that did reach the server will be returned rather than duplicated.
      setFormError(t('networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="rounded-card border border-line bg-card p-5"
    >
      <h2 className="font-display text-lg text-text">{t('guestDetails')}</h2>
      <p className="mt-1 text-sm text-faint">{t('noAccountNeeded')}</p>

      {formError ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {formError}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4">
        <Field
          name="fullName"
          label={t('fullName')}
          autoComplete="name"
          error={fieldErrors['guest.fullName']}
          required
        />
        <Field
          name="email"
          type="email"
          label={t('email')}
          autoComplete="email"
          error={fieldErrors['guest.email']}
          required
        />
        <Field
          name="phone"
          type="tel"
          label={t('phone')}
          placeholder="+963912345678"
          autoComplete="tel"
          hint={t('phoneHint')}
          error={fieldErrors['guest.phone']}
          required
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 w-full rounded-lg bg-gold px-5 py-3 font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? t('submitting') : t('submit')}
      </button>

      <p className="mt-3 text-xs text-faint">{t('terms')}</p>

      <input type="hidden" name="propertySlug" value={propertySlug} />
    </form>
  );
}

/**
 * Reads a text field from FormData.
 *
 * `FormData.get` returns `string | File`, so coercing it with String() would turn a
 * file input into the literal "[object File]" and post it as someone's name. Anything
 * that is not a string is treated as absent, and the API's schema rejects it.
 */
function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function Field({
  name,
  label,
  error,
  hint,
  ...rest
}: {
  name: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `field-${name}`;
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-muted">
        {label} <span className="text-gold">*</span>
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy || undefined}
        className={`rounded-lg border bg-field px-3 py-2.5 text-text ${
          error ? 'border-bad' : 'border-line'
        }`}
        {...rest}
      />
      {hint ? (
        <span id={`${id}-hint`} className="text-xs text-faint">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-error`} className="text-xs text-bad">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Turns an API error into something the customer can act on.
 *
 * The two cases that matter are the ones the SRS defines: a 409 means the dates were
 * taken while they were filling the form (EC-005), and a 400 with `firstBookableDate`
 * means the same-day cutoff closed (§5.3). Both are normal outcomes, not faults, and
 * a generic "something went wrong" would leave the customer with no idea what to do.
 */
function applyError(
  body: unknown,
  status: number,
  handlers: {
    setFormError: (message: string) => void;
    setFieldErrors: (errors: FieldErrors) => void;
    t: (key: string, values?: Record<string, string | number>) => string;
  },
): void {
  const { setFormError, setFieldErrors, t } = handlers;

  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;

    // Field-level validation errors from the shared Zod schema.
    if (Array.isArray(record['errors'])) {
      const mapped: FieldErrors = {};

      for (const entry of record['errors']) {
        if (typeof entry === 'object' && entry !== null && 'field' in entry) {
          const item = entry as { field?: unknown; message?: unknown };
          if (typeof item.field === 'string' && typeof item.message === 'string') {
            mapped[item.field] = item.message;
          }
        }
      }

      if (Object.keys(mapped).length > 0) {
        setFieldErrors(mapped);
        setFormError(t('fixFields'));
        return;
      }
    }

    if (status === 409) {
      setFormError(t('datesTaken'));
      return;
    }

    if (
      record['reason'] === 'same_day_closed' &&
      typeof record['firstBookableDate'] === 'string'
    ) {
      setFormError(t('cutoffClosed', { date: record['firstBookableDate'] }));
      return;
    }

    if (typeof record['message'] === 'string') {
      setFormError(record['message']);
      return;
    }
  }

  setFormError(t('genericError'));
}
