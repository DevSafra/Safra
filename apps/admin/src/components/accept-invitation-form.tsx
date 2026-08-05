'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { PasswordField } from '@safra/ui';

import { text } from '@/lib/form';
import { t } from '@/lib/strings';

/**
 * Setting a first password from an invitation link (M-5).
 *
 * The token comes from the URL and is never shown or editable — the recipient has no
 * session, so it is the only thing authenticating them, and a field they could edit
 * invites them to paste someone else's.
 *
 * Posts to this app's own route handler rather than the API directly, matching every
 * other mutation here: the browser never holds an API origin or a credential.
 */
export function AcceptInvitationForm({ token }: { token: string }) {
  const router = useRouter();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const form = new FormData(event.currentTarget);
    const password = text(form, 'password');
    const confirm = text(form, 'confirm');

    /**
     * Checked here as well as on the server. A mistyped password on the one form a
     * new staff member cannot retry — the link is single-use — would otherwise lock
     * them out of an account they have never used.
     */
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/staff-invitation/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(messageOf(body) ?? 'Could not set your password.');
        setSubmitting(false);
        return;
      }

      setDone(true);
    } catch {
      setError('Could not reach the server. Please try again.');
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-ok/40 bg-ok/10 p-4">
        <p className="text-sm text-text">{t.sections.invitation.passwordSet}</p>
        <p className="mt-2 text-xs text-muted">{t.sections.invitation.signInNext}</p>
        <button
          type="button"
          onClick={() => router.push('/login')}
          className="cursor-pointer mt-4 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-bg"
        >
          {t.sections.invitation.goToSignIn}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="grid gap-4">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {error}
        </p>
      ) : null}

      <PasswordField
        showLabel={t.login.showPassword}
        hideLabel={t.login.hidePassword}
        name="password"
        label={t.sections.invitation.newPassword}
        required
        minLength={12}
        autoComplete="new-password"
        hint="At least 12 characters."
      />

      <PasswordField
        showLabel={t.login.showPassword}
        hideLabel={t.login.hidePassword}
        name="confirm"
        label={t.sections.invitation.confirmPassword}
        required
        minLength={12}
        autoComplete="new-password"
      />

      <button
        type="submit"
        disabled={submitting}
        className="cursor-pointer rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Setting your password…' : 'Set password'}
      </button>
    </form>
  );
}

function messageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;

  const { message } = body;
  return typeof message === 'string' ? message : null;
}
