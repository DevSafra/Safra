'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ERROR } from '@safra/contracts';
import { PasswordField, PasswordStrengthMeter, passwordsMatch } from '@safra/ui';

import { t } from '@/lib/strings';

/**
 * Setting the first password on an invited employee's account.
 *
 * A near-twin of `InvitationForm`, and kept separate rather than parameterised. The two post to
 * different endpoints, carry different copy and redeem into different roles; folding them into one
 * component with a `variant` prop would put the decision of WHICH ROLE somebody is being granted
 * behind a boolean, which is the shape the API deliberately refuses on its own side.
 *
 * ## Every refusal reads the same, except the password
 *
 * Expired, already spent, never existed, employment withdrawn since it was sent — the API answers
 * all four with `EMPLOYEE_INVITATION_INVALID`, and this form does not invent a distinction it was
 * denied. A page that said "expired" rather than "never existed" tells somebody working through
 * invitation links which of their guesses were close.
 *
 * The one thing worth separating is a weak password, because that is the reader's own input and
 * the remedy is on this screen. Everything else sends them to their employer.
 */
export function EmployeeInvitationForm({ token }: { token: string }) {
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    /*
      Checked here as well as by the API, because the API cannot check it at all — it receives one
      password. Getting it wrong twice the same way locks somebody out of an account they have
      never used, and there is no "forgot password" that helps before activation.
    */
    if (!passwordsMatch(password, confirm)) {
      setError(t.employeeInvitation.mismatch);

      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/employee-invitation', {
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

      setError(
        code === ERROR.REQUEST_VALIDATION_FAILED
          ? t.employeeInvitation.weak
          : code === ERROR.EMPLOYEE_INVITATION_INVALID ||
              response.status === 400 ||
              response.status === 404
            ? t.employeeInvitation.invalidLink
            : t.employeeInvitation.failed,
      );
      setBusy(false);
    } catch {
      setError(t.employeeInvitation.failed);
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="grid gap-4 rounded-card border border-ok/40 bg-ok/5 p-4">
        <p className="text-sm text-ok">{t.employeeInvitation.done}</p>
        {/*
          A button to sign in, not an automatic redirect. The API issues no session on activation,
          so the next screen is a sign-in form either way — and bouncing somebody there without a
          word reads as the activation having failed.
        */}
        <button
          type="button"
          onClick={() => router.push('/login')}
          className="w-fit cursor-pointer rounded-lg bg-gold px-5 py-3 font-semibold text-bg transition-opacity hover:opacity-90"
        >
          {t.employeeInvitation.signIn}
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
        No `dir` on either field: a field a person types into follows the PAGE's direction, which
        here is RTL (Bashar, 2026-08-19). A Latin password is a left-to-right RUN and the bidi
        algorithm lays it out correctly inside an RTL field without being told; `dir="ltr"` would
        move the caret and the value to the far side of a label sitting on the right.
      */}
      <PasswordField
        label={t.employeeInvitation.password}
        showLabel={t.login.showPassword}
        hideLabel={t.login.hidePassword}
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />

      {/* The five rules `passwordSchema` enforces, live — being told them after a refusal is how
          somebody ends up typing five variations of the same rejected password. */}
      {password ? (
        <PasswordStrengthMeter
          password={password}
          progressLabel={t.employeeInvitation.strengthLabel}
          labels={{
            length: t.employeeInvitation.ruleLength,
            uppercase: t.employeeInvitation.ruleUppercase,
            lowercase: t.employeeInvitation.ruleLowercase,
            digit: t.employeeInvitation.ruleDigit,
            symbol: t.employeeInvitation.ruleSymbol,
          }}
        />
      ) : null}

      <PasswordField
        label={t.employeeInvitation.confirm}
        showLabel={t.login.showPassword}
        hideLabel={t.login.hidePassword}
        autoComplete="new-password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        required
      />

      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-2 cursor-pointer rounded-lg bg-gold px-5 py-3 font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? t.employeeInvitation.submitting : t.employeeInvitation.submit}
      </button>
    </form>
  );
}
