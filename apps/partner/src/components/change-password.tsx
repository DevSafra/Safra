'use client';

import { useState } from 'react';

import { PasswordField, PasswordStrengthMeter, passwordsMatch } from '@safra/ui';

import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { t } from '@/lib/strings';

/**
 * Changing your own password, from the portal (Bashar, 2026-09-04).
 *
 * ## Why it belongs here
 *
 * *"add a new tab for حسابات التحويل or add it inside a new settings page, where the partner also
 * can change his password"*. `POST /auth/me/password` has existed throughout — throttled to five a
 * minute, audited on success AND on a wrong current password, and it ends every other session —
 * and no screen in the portal called it. A partner who believed their password was compromised had
 * to use the forgotten-password flow on the sign-in page, which is a worse path for somebody who
 * is already signed in and knows their password perfectly well.
 *
 * ## Every field is a `PasswordField`
 *
 * The house rule, and it earns itself here more than anywhere: three masked boxes with no way to
 * reveal them is three chances to mistype, and the third is a confirmation whose only purpose is
 * to catch the first two.
 *
 * ## The consequence is stated before the button, not after
 *
 * The API ends every other session — including this browser's refresh family — so the partner will
 * be signed out. That is the correct behaviour (people change a password because they think
 * somebody else has it) and it is not what anybody expects from a settings form, so it is said
 * above the fields rather than discovered.
 *
 * ## The match is checked HERE and also upstream
 *
 * Not because the API cannot — it refuses an unchanged password itself — but because a mismatch is
 * a typo, and a typo deserves an answer without a round trip that spends one of five attempts a
 * minute against a throttle that exists to stop somebody guessing at a borrowed screen.
 */
export function ChangePassword() {
  const c = t.settings;

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(
    null,
  );

  const ready = current !== '' && next !== '' && confirm !== '';

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    if (busy || !ready) return;

    if (!passwordsMatch(next, confirm)) {
      setMessage({ kind: 'bad', text: c.passwordMismatch });

      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });

      if (!response.ok) {
        /*
          `refusalFor` first, so «الحساب موقوف» is said as itself — the rule every write component
          in this portal follows. Everything else falls to the API's own sentence, which names the
          wrong current password and the unchanged-password refusal in the reader's language.
        */
        const code = await codeOfResponse(response);

        setMessage({
          kind: 'bad',
          text: refusalFor(code) ?? apiMessage(code) ?? c.passwordFailed,
        });
        setBusy(false);

        return;
      }

      /*
        Cleared on success. The fields hold a password that no longer works and one that now does;
        leaving either in the DOM of a screen somebody walks away from is the opposite of what this
        form is for.
      */
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage({ kind: 'ok', text: c.passwordChanged });
      setBusy(false);
    } catch {
      setMessage({ kind: 'bad', text: t.editProperty.unreachable });
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-3"
      data-change-password
    >
      <p className="text-[11.5px] leading-relaxed text-faint">{c.passwordNote}</p>

      {message ? (
        <p
          role="alert"
          className={`rounded-lg border p-2.5 text-[12px] leading-relaxed ${
            message.kind === 'ok'
              ? 'border-good/40 bg-good/10 text-good'
              : 'border-bad/40 bg-bad/10 text-bad'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {/*
        No `dir` on any field: one a person types into follows the PAGE, which here is RTL. A Latin
        password is a left-to-right RUN and the bidi algorithm lays it out correctly without being
        told — `dir="ltr"` would move the caret to the far side of a label sitting on the right.
      */}
      <PasswordField
        label={c.currentPassword}
        showLabel={t.login.showPassword}
        hideLabel={t.login.hidePassword}
        autoComplete="current-password"
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
        required
      />

      <PasswordField
        label={c.newPassword}
        showLabel={t.login.showPassword}
        hideLabel={t.login.hidePassword}
        autoComplete="new-password"
        value={next}
        onChange={(event) => setNext(event.target.value)}
        required
      />

      {next ? (
        <PasswordStrengthMeter
          password={next}
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
        label={c.confirmPassword}
        showLabel={t.login.showPassword}
        hideLabel={t.login.hidePassword}
        autoComplete="new-password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        required
      />

      <button
        type="submit"
        disabled={busy || !ready}
        className="min-h-10 w-fit cursor-pointer rounded-lg border border-gold px-4 py-1.5 text-[12px] font-bold text-gold disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
      >
        {busy ? c.passwordSaving : c.passwordSubmit}
      </button>
    </form>
  );
}

/**
 * The API's own sentence for a refusal this form can meet.
 *
 * Only the two it actually produces — a wrong current password and a new one identical to the old.
 * A map of every code would be a second error catalogue; returning `undefined` keeps this strictly
 * additive and lets the form's own vocabulary own everything else.
 */
function apiMessage(code: unknown): string | undefined {
  if (code === 'auth.password_incorrect') return t.settings.passwordIncorrect;
  if (code === 'validation.password_unchanged') return t.settings.passwordUnchanged;

  return undefined;
}
