'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Staff sign-in (SRS §4, §9).
 *
 * The TOTP field is always visible rather than appearing after a first attempt.
 * Revealing it conditionally would tell an attacker which accounts have 2FA enabled
 * — useful reconnaissance for deciding which credentials are worth phishing — and it
 * costs an enrolled staff member an extra round trip every single sign-in.
 */
export function StaffLoginForm({ next }: { next: string }) {
  const router = useRouter();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const code = text(form, 'totpCode').trim();

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: text(form, 'email'),
          password: text(form, 'password'),
          // Omitted rather than sent empty: the schema is .strict() and an empty
          // string is not a six-digit code.
          ...(code ? { totpCode: code } : {}),
        }),
      });

      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(describe(body, response.status));
        setSubmitting(false);
        return;
      }

      /**
       * `refresh()` before navigating: the session is an HttpOnly cookie the React
       * tree cannot see, so without it the server components render from cache and
       * still believe nobody is signed in.
       */
      router.refresh();
      router.push(requiresEnrolment(body) ? '/enrol-2fa' : next);
    } catch {
      setError('Could not reach the server. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      noValidate
      className="grid gap-4"
    >
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {error}
        </p>
      ) : null}

      <Field name="email" type="email" label="Email" autoComplete="username" required />
      <Field
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
      />
      <Field
        name="totpCode"
        label="Authenticator code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        hint="Leave blank if you have not set up two-factor authentication yet."
      />

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 rounded-lg bg-gold px-5 py-3 font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function requiresEnrolment(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as Record<string, unknown>)['requiresTwoFactorEnrolment'] === true
  );
}

/**
 * The 401 stays vague because the API's does: login answers identically for an
 * unknown email and a wrong password so it cannot be used to enumerate accounts.
 * The 403 is specific, because by then the person has already proved the credentials
 * are theirs and the only useful thing to say is that this account is not staff.
 */
function describe(body: unknown, status: number): string {
  if (status === 401) return 'That email, password or code was not accepted.';
  if (status === 403) return 'This account does not have access to the command center.';
  if (status === 423) return 'This account is temporarily locked. Try again shortly.';
  if (status === 429) return 'Too many attempts. Wait a minute and try again.';

  if (typeof body === 'object' && body !== null && 'message' in body) {
    const { message } = body;
    if (typeof message === 'string') return message;
  }

  return 'Something went wrong. Please try again.';
}

function Field({
  name,
  label,
  hint,
  ...rest
}: {
  name: string;
  label: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `field-${name}`;

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="rounded-lg border border-line bg-field px-3 py-2.5 text-text"
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
