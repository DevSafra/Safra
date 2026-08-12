'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { PasswordField, passwordMismatch, passwordsMatch } from '@safra/ui';

import { reloadInto } from '@/lib/session-navigation';

/**
 * الملف الشخصي's two forms (handoff §6).
 *
 * ## Why the password field is `PasswordField`
 *
 * A project rule, and it applies here more than anywhere: a masked field with no way to reveal it makes
 * people mistype, and this form asks for two passwords at once. `PasswordField` from `@safra/ui` carries
 * the eye toggle, so the rule is structural rather than remembered.
 *
 * ## Why the password form signs you out
 *
 * Changing a password revokes every refresh token for the account, including the caller's own. That is
 * deliberate — people change a password because they believe somebody else has it — so the honest thing
 * is to say so and send them to sign in, rather than let their session break silently within the
 * quarter hour.
 */

interface Labels {
  readonly editTitle: string;
  readonly fullName: string;
  readonly phone: string;
  readonly save: string;
  readonly saving: string;
  readonly saved: string;
  readonly saveFailed: string;
}

export function ProfileForm({
  locale,
  initial,
  labels,
}: {
  readonly locale: string;
  readonly initial: { readonly fullName: string; readonly phone: string };
  readonly labels: Labels;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState(initial.fullName);
  const [phone, setPhone] = useState(initial.phone);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(
    null,
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (busy) return;

    setBusy(true);
    setMessage(null);

    /*
      Only what CHANGED. The contract treats an omitted field as "leave it alone", so sending both
      every time would rewrite a value the reader never touched — and would fail its own
      at-least-one-field rule when nothing changed at all.
    */
    const body: Record<string, string> = {};

    if (fullName.trim() !== initial.fullName) body['fullName'] = fullName.trim();
    if (phone.trim() !== initial.phone) body['phone'] = phone.trim();

    if (Object.keys(body).length === 0) {
      setBusy(false);
      setMessage({ kind: 'ok', text: labels.saved });

      return;
    }

    try {
      const response = await fetch(`/${locale}/api/account/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      setBusy(false);

      if (!response.ok) {
        setMessage({ kind: 'bad', text: labels.saveFailed });

        return;
      }

      setMessage({ kind: 'ok', text: labels.saved });
      /* So the greeting and the sidebar pick up a new name without a manual reload. */
      router.refresh();
    } catch {
      setBusy(false);
      setMessage({ kind: 'bad', text: labels.saveFailed });
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-3 rounded-card border border-line bg-card p-5"
    >
      <h2 className="font-display text-lg text-text">{labels.editTitle}</h2>

      {message ? (
        <p
          role="alert"
          className={`rounded-lg border p-3 text-sm ${
            message.kind === 'ok'
              ? 'border-ok/40 bg-ok/10 text-ok'
              : 'border-bad/40 bg-bad/10 text-bad'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <label className="grid gap-1">
        <span className="text-sm text-muted">{labels.fullName}</span>
        <input
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          minLength={2}
          maxLength={120}
          required
          className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-text lg:min-h-0"
        />
      </label>

      <label className="grid gap-1">
        <span className="text-sm text-muted">{labels.phone}</span>
        {/*
          `field-ltr`, not `dir="ltr"`: the number is laid out left to right, and it still sits at the
          reader's start edge — the right, in Arabic. See the class in `globals.css`.
        */}
        <input
          name="phone"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          inputMode="tel"
          required
          className="field-ltr min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-text lg:min-h-0"
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        className="min-h-10 w-fit cursor-pointer rounded-lg bg-gold px-5 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 lg:py-2.5"
      >
        {busy ? labels.saving : labels.save}
      </button>
    </form>
  );
}

interface PasswordLabels {
  readonly title: string;
  readonly current: string;
  readonly next: string;
  readonly confirm: string;
  readonly mismatch: string;
  readonly show: string;
  readonly hide: string;
  readonly submit: string;
  readonly submitting: string;
  readonly changed: string;
  readonly wrong: string;
  readonly failed: string;
  readonly rule: string;
}

export function PasswordForm({
  locale,
  labels,
}: {
  readonly locale: string;
  readonly labels: PasswordLabels;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(
    null,
  );

  /* Shown on the confirmation FIELD, and only once there is something typed there to compare. */
  const mismatch = passwordMismatch(newPassword, confirmPassword);

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (busy) return;

    /*
      The guard is `passwordsMatch`, not `!mismatch`.

      They differ while the confirmation is still empty — `mismatch` is deliberately false then, so
      submitting with an untouched confirmation field would otherwise go straight through and change
      the password to whatever is in the first field alone.
    */
    if (!passwordsMatch(newPassword, confirmPassword)) {
      setMessage({ kind: 'bad', text: labels.mismatch });

      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/${locale}/api/account/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const code =
          payload && typeof payload === 'object' && 'code' in payload
            ? String(payload.code)
            : '';

        setBusy(false);
        /*
          A wrong CURRENT password gets its own sentence. Anything else is apologised for generically:
          the specific reason is in the server log, and a validation detail read back to the client is
          how a policy becomes a guessing aid.
        */
        setMessage({
          kind: 'bad',
          text: code === 'auth.password_incorrect' ? labels.wrong : labels.failed,
        });

        return;
      }

      /* Cleared immediately: nothing is served by leaving three passwords in a form's state. */
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setBusy(false);
      setMessage({ kind: 'ok', text: labels.changed });

      /*
        Every session was revoked, this one included, so the reader is sent to sign in. Left on the
        page, their session would keep working until the access token expired and then break with no
        explanation.
      */
      /* Every session was revoked, this one included, so the whole document has to be re-fetched. */
      reloadInto(`/${locale}/login`);
    } catch {
      setBusy(false);
      setMessage({ kind: 'bad', text: labels.failed });
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-3 rounded-card border border-line bg-card p-5"
    >
      <h2 className="font-display text-lg text-text">{labels.title}</h2>

      {message ? (
        <p
          role="alert"
          className={`rounded-lg border p-3 text-sm ${
            message.kind === 'ok'
              ? 'border-ok/40 bg-ok/10 text-ok'
              : 'border-bad/40 bg-bad/10 text-bad'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <PasswordField
        label={labels.current}
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        showLabel={labels.show}
        hideLabel={labels.hide}
        autoComplete="current-password"
        required
      />

      <PasswordField
        label={labels.next}
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        showLabel={labels.show}
        hideLabel={labels.hide}
        hint={labels.rule}
        autoComplete="new-password"
        minLength={12}
        required
      />

      {/*
        The confirmation, and the mismatch is reported HERE rather than as a form-level banner.

        `PasswordField`'s `error` sets `aria-invalid` and `aria-describedby` on the input itself, so a
        screen reader announces the problem against the field that has it — a banner at the top of a
        three-field form says something is wrong without saying which one.

        The value is never sent. The API has no second password to compare it against, and
        `passwordChangeSchema` is `.strict()`, so an extra field would be refused outright.
      */}
      <PasswordField
        label={labels.confirm}
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        showLabel={labels.show}
        hideLabel={labels.hide}
        error={mismatch ? labels.mismatch : undefined}
        autoComplete="new-password"
        minLength={12}
        required
      />

      <button
        type="submit"
        disabled={busy || mismatch}
        className="min-h-10 w-fit cursor-pointer rounded-lg bg-gold px-5 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 lg:py-2.5"
      >
        {busy ? labels.submitting : labels.submit}
      </button>
    </form>
  );
}
