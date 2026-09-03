'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ERROR } from '@safra/contracts';
import { PasswordField, PasswordStrengthMeter, passwordsMatch } from '@safra/ui';

import { t } from '@/lib/strings';

/**
 * Setting the first password on an accepted partner account.
 *
 * ## Both fields, and the meter
 *
 * `PasswordField` is the house rule for every password input — it carries the show/hide eye, and a
 * masked field with no way to reveal it makes people mistype. The confirm field exists because
 * this password cannot be recovered by the person setting it: get it wrong twice the same way and
 * they are locked out of an account they have not used yet.
 *
 * The strength meter shows the five rules `passwordSchema` enforces, live. The API refuses a weak
 * password with a validation code, and being told the rules AFTER submitting a form is how people
 * end up typing five variations of the same rejected password.
 *
 * ## Every refusal reads the same
 *
 * A bad token, an expired token and a token for an account that has already been converted all
 * produce `invalidLink`. The API declines to distinguish them and this form does not invent a
 * distinction: a page that says "expired" rather than "never existed" tells somebody probing
 * invitation links which of their guesses were close.
 */
export function InvitationForm({ token }: { token: string }) {
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    if (!passwordsMatch(password, confirm)) {
      setError(t.invitation.mismatch);

      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      if (response.ok) {
        setDone(true);
        setBusy(false);

        return;
      }

      const body: unknown = await response.json().catch(() => null);
      const code =
        typeof body === 'object' && body !== null && 'code' in body
          ? (body as { code?: unknown }).code
          : null;

      /*
        A 400 here is almost always the password failing `passwordSchema` — the token is the only
        other field and it came from the URL, not from typing. Saying which is the difference
        between a partner fixing their password and a partner emailing support about a broken link.
      */
      setError(
        code === ERROR.REQUEST_VALIDATION_FAILED
          ? t.invitation.weak
          : response.status === 400 || response.status === 404
            ? t.invitation.invalidLink
            : t.invitation.failed,
      );
      setBusy(false);
    } catch {
      setError(t.invitation.failed);
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="grid gap-4 rounded-card border border-ok/40 bg-ok/5 p-4">
        <p className="text-sm text-ok">{t.invitation.done}</p>
        <button
          type="button"
          onClick={() => router.push('/login')}
          className="w-fit cursor-pointer rounded-lg bg-gold px-5 py-3 font-semibold text-bg transition-opacity hover:opacity-90"
        >
          {t.invitation.signIn}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      noValidate
      className="grid gap-4"
    >
      {/*
        No `dir` on either field. A field a person types into follows the PAGE's direction, which
        here is RTL — `dir="ltr"` would move the caret and the value to the far side of a label
        sitting on the right (Bashar, 2026-08-19). A Latin password is a left-to-right RUN and the
        bidi algorithm lays it out correctly inside an RTL field without being told.
      */}
      <PasswordField
        label={t.invitation.password}
        showLabel={t.login.showPassword}
        hideLabel={t.login.hidePassword}
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />

      {password ? (
        <PasswordStrengthMeter
          password={password}
          progressLabel={t.invitation.strengthLabel}
          labels={{
            length: t.invitation.ruleLength,
            uppercase: t.invitation.ruleUppercase,
            lowercase: t.invitation.ruleLowercase,
            digit: t.invitation.ruleDigit,
            symbol: t.invitation.ruleSymbol,
          }}
        />
      ) : null}

      <PasswordField
        label={t.invitation.confirm}
        showLabel={t.login.showPassword}
        hideLabel={t.login.hidePassword}
        autoComplete="new-password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        required
      />

      {error ? <p className="text-sm text-bad">{error}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-2 cursor-pointer rounded-lg bg-gold px-5 py-3 font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? t.invitation.submitting : t.invitation.submit}
      </button>
    </form>
  );
}
