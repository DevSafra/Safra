'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import type { Locale } from '@/i18n/routing';

import { PasswordField, passwordsMatch } from '@safra/ui';

import { reloadInto } from '@/lib/session-navigation';

/**
 * Both halves of a password reset (SRS §4).
 *
 * `request` asks for the link; `confirm` sets the new password. One component
 * because the error handling, the disabled-while-submitting behaviour and the
 * field markup are identical, and the two screens differ only in which input they
 * show.
 */
export function PasswordResetForm({
  locale,
  mode,
  token,
}: {
  locale: Locale;
  mode: 'request' | 'confirm';
  /** Present only in confirm mode, taken from the emailed link. */
  token?: string;
}) {
  const t = useTranslations('auth');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);

    /*
      A mistyped new password costs MORE here than on the profile form.

      There is no current password to prove who this is, the token is single-use, and the customer is
      locked out of the account they were in the middle of recovering — the way back is another email.
      So the two fields are compared before anything is sent.
    */
    if (
      mode === 'confirm' &&
      !passwordsMatch(text(form, 'password'), text(form, 'confirm'))
    ) {
      setError(t('passwordMismatch'));
      setSubmitting(false);

      return;
    }

    const body =
      mode === 'request'
        ? { email: text(form, 'email') }
        : { token: token ?? '', password: text(form, 'password') };

    try {
      const response = await fetch(`/${locale}/api/auth/password-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        setError(await describe(response, t));
        setSubmitting(false);
        return;
      }

      if (mode === 'request') {
        setSent(true);
        setSubmitting(false);
        return;
      }

      /**
       * Straight to sign-in, not to the account page. The reset revoked every
       * session including any this browser held, so there is nothing to return to —
       * the customer has to authenticate with the password they just chose.
       */
      /* The reset revoked every session, so the header must be rebuilt from the cleared cookie. */
      reloadInto(`/${locale}/login?reset=1`);
    } catch {
      setError(t('networkError'));
      setSubmitting(false);
    }
  }

  /**
   * The confirmation is deliberately non-committal about whether the address
   * matched an account — it mirrors the API, which answers identically either way so
   * the form cannot be used to discover who has an account here.
   */
  if (sent) {
    return (
      <p className="rounded-lg border border-sky/30 bg-sky/10 p-4 text-sm text-sky">
        {t('resetSent')}
      </p>
    );
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      noValidate
      className="flex flex-col gap-4"
    >
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {error}
        </p>
      ) : null}

      {mode === 'request' ? (
        <Field
          name="email"
          type="email"
          label={t('email')}
          autoComplete="email"
          inputMode="email"
          required
        />
      ) : (
        <>
          <PasswordField
            showLabel={t('showPassword')}
            hideLabel={t('hidePassword')}
            name="password"
            label={t('newPassword')}
            autoComplete="new-password"
            hint={t('passwordHint')}
            required
          />

          {/* Never sent: the API takes one password, and the confirmation is a typo guard. */}
          <PasswordField
            showLabel={t('showPassword')}
            hideLabel={t('hidePassword')}
            name="confirm"
            label={t('confirmNewPassword')}
            autoComplete="new-password"
            required
          />
        </>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 w-full rounded-lg bg-gold px-5 py-3 font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting
          ? t('submitting')
          : t(mode === 'request' ? 'sendResetLink' : 'setNewPassword')}
      </button>
    </form>
  );
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

async function describe(
  response: Response,
  t: ReturnType<typeof useTranslations<'auth'>>,
): Promise<string> {
  const body: unknown = await response.json().catch(() => null);

  if (typeof body === 'object' && body !== null && 'errors' in body) {
    const { errors } = body;

    if (Array.isArray(errors)) {
      const first: unknown = errors[0];

      if (typeof first === 'object' && first !== null && 'message' in first) {
        const { message } = first;
        if (typeof message === 'string') return message;
      }
    }
  }

  if (response.status === 400) return t('resetLinkInvalid');
  if (response.status === 429) return t('tooManyAttempts');

  return t('genericError');
}

function Field({
  name,
  label,
  hint,
  ...rest
}: {
  name: string;
  label: string;
  hint?: string | undefined;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  /*
    A phone number, an email or a URL is laid out LEFT TO RIGHT whatever the page reads.

    `field-ltr` sets the direction and takes the ALIGNMENT from the document rather than from the
    element, so the value still sits at the reader's start edge — the right, in Arabic. `dir="ltr"`
    alone fixes the order and breaks the placement: the value goes flush left inside a full-width
    field while its own label sits on the right. Reported by Bashar against البريد الإلكتروني and
    رقم الهاتف (2026-08-11); the profile form was fixed then and this shared `Field` was not, which
    is why the checkout and registration phone fields still had it (2026-08-13).
  */
  const latinValue = rest.type === 'tel' || rest.type === 'email' || rest.type === 'url';

  const id = `field-${name}`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-muted">
        {label} <span className="text-gold">*</span>
      </label>
      <input
        id={id}
        name={name}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`rounded-lg border border-line bg-field px-3 py-2.5 text-text ${
          latinValue ? 'field-ltr' : ''
        }`}
        {...rest}
      />
      {hint ? (
        <span id={`${id}-hint`} className="text-xs text-faint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
