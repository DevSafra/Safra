'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { PasswordField } from '@safra/ui';

import { AR, apiError } from '@/lib/strings';

/** A six-digit authenticator code, as opposed to a recovery code. */
const TOTP_PATTERN = /^\d{6}$/;

/**
 * Staff sign-in, in two steps (SRS §4, §9).
 *
 * Credentials first; the second factor is asked for only once they are accepted.
 *
 * ## Why revealing the second step is not a disclosure
 *
 * An earlier version showed the code field from the start, reasoning that revealing it
 * conditionally tells an attacker which accounts have 2FA enabled. That reasoning does
 * not survive contact with the API: `AuthService.login` returns `Invalid email or
 * password` for bad credentials and `Authenticator code required` only once the password
 * has been ACCEPTED. So the information was already available to anyone holding a valid
 * password, and this form merely stops hiding what the server already says.
 *
 * ## Every input is controlled, deliberately
 *
 * The first attempt at this used uncontrolled inputs with `defaultValue`, and it failed
 * in two ways that were reported from the browser: the code field arrived pre-filled
 * with the password, and going back left the email box empty. Both had one cause —
 * `defaultValue` applies only when an input MOUNTS, and React reuses a DOM node when the
 * element type at that position is unchanged. Switching steps swapped one `<input>` for
 * another, so the node was recycled with its old value and `defaultValue` never ran.
 *
 * Controlled inputs make the rendered value a function of state on every render, so none
 * of that matters. It also means "empty the code field" and "keep the credentials" are
 * plain state operations rather than assertions about reconciliation.
 *
 * ## What step one is
 *
 * A genuine login attempt, not a password check. There is no endpoint that validates a
 * password without signing in, and adding one would be a password oracle with none of
 * the lockout and audit behaviour the real path carries. So step one posts to `/login`
 * and reads the outcome:
 *
 * - `401 Authenticator code required` — credentials good, ask for the code
 * - `200` — no second factor on this account, so it is signed in and heading for
 *   enrolment
 * - anything else — a real failure, shown as such
 */
export function StaffLoginForm({ next }: { next: string }) {
  const router = useRouter();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Held across both steps. Going back to step one does NOT clear these — the usual
   * reason to go back is to correct one field, not to retype both.
   */
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  /** Emptied on every entry into step two; see `askForCode`. */
  const [code, setCode] = useState('');

  /** Which step is showing. Separate from the values, which outlive it. */
  const [awaitingCode, setAwaitingCode] = useState(false);

  const codeInput = useRef<HTMLInputElement>(null);

  async function attempt(
    body: Record<string, string>,
  ): Promise<{ ok: boolean; status: number; payload: unknown }> {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return {
      ok: response.ok,
      status: response.status,
      payload: (await response.json().catch(() => null)) as unknown,
    };
  }

  /**
   * `refresh()` before navigating: the session is an HttpOnly cookie the React tree
   * cannot see, so without it the server components render from cache and still
   * believe nobody is signed in.
   */
  function enter(payload: unknown): void {
    router.refresh();
    router.push(requiresEnrolment(payload) ? '/enrol-2fa' : next);
  }

  /**
   * Moves to step two with an EMPTY code box.
   *
   * A stale code left in the field is worse than a blank one: it looks like a valid
   * entry and is silently expired, so the failure reads as "wrong code" when nothing
   * was actually retyped.
   */
  function askForCode(): void {
    setCode('');
    setAwaitingCode(true);
    // Focus follows the newly revealed field, so the flow stays keyboard-only.
    requestAnimationFrame(() => codeInput.current?.focus());
  }

  async function submitCredentials(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const { ok, status, payload } = await attempt({
        email: email.trim(),
        password,
      });

      if (ok) {
        // No second factor on this account — signed in, and the middleware will hold
        // it at enrolment.
        enter(payload);
        return;
      }

      if (status === 401 && needsSecondFactor(payload)) {
        askForCode();
        setSubmitting(false);
        return;
      }

      setError(describe(payload, status));
      setSubmitting(false);
    } catch {
      setError(AR.errors.unreachable);
      setSubmitting(false);
    }
  }

  async function submitCode(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    const entered = code.trim();

    try {
      /**
       * One field, two kinds of secret. Six digits is an authenticator code; anything
       * else is treated as a recovery code, which the API validates in its own format.
       * Asking the person which kind they are holding would be a question they should
       * not have to answer.
       */
      const { ok, status, payload } = await attempt({
        email: email.trim(),
        password,
        ...(TOTP_PATTERN.test(entered)
          ? { totpCode: entered }
          : { recoveryCode: entered.toUpperCase() }),
      });

      if (ok) {
        enter(payload);
        return;
      }

      setError(describe(payload, status));
      setSubmitting(false);
    } catch {
      setError(AR.errors.unreachable);
      setSubmitting(false);
    }
  }

  /** Back to step one, with what was typed still in the fields. */
  function startOver(): void {
    setAwaitingCode(false);
    setError(null);
  }

  return (
    <div className="grid gap-4">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {error}
        </p>
      ) : null}

      {awaitingCode ? (
        <form
          /**
           * Distinct keys on the two forms, so React unmounts one and mounts the other
           * rather than reconciling them field-by-field. Controlled values already make
           * the rendered content correct; this additionally guarantees the browser gets
           * a NEW input element, which is what stops a password manager's fill — or any
           * recycled DOM value — carrying across the step change.
           */
          key="second-factor"
          onSubmit={(event) => void submitCode(event)}
          noValidate
          className="grid gap-4"
        >
          <p className="text-sm text-muted">
            {AR.login.signingInAs} <span className="text-text">{email.trim()}</span>
          </p>

          <Field
            ref={codeInput}
            name="code"
            label={AR.login.code}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            /**
             * `one-time-code` is the correct semantic and tells a password manager this
             * is not a credential field — which is what stopped it being filled with the
             * saved password.
             */
            autoComplete="one-time-code"
            required
            hint={AR.login.codeHint}
          />

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 cursor-pointer rounded-lg bg-gold px-5 py-3 font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? AR.login.submittingCode : AR.login.submitCode}
          </button>

          {/* A way back, because the alternative is reloading the page. */}
          <button
            type="button"
            onClick={startOver}
            className="cursor-pointer text-sm text-muted underline-offset-4 hover:text-gold hover:underline"
          >
            {AR.login.useDifferentAccount}
          </button>
        </form>
      ) : (
        <form
          key="credentials"
          onSubmit={(event) => void submitCredentials(event)}
          noValidate
          className="grid gap-4"
        >
          <Field
            name="email"
            type="email"
            label={AR.login.email}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
          />
          <PasswordField
            name="password"
            label={AR.login.password}
            showLabel={AR.login.showPassword}
            hideLabel={AR.login.hidePassword}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 cursor-pointer rounded-lg bg-gold px-5 py-3 font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? AR.login.submittingCredentials : AR.login.submitCredentials}
          </button>
        </form>
      )}
    </div>
  );
}

function requiresEnrolment(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as Record<string, unknown>)['requiresTwoFactorEnrolment'] === true
  );
}

/**
 * Whether a 401 means "credentials fine, now the code" rather than a real failure.
 *
 * Matched on the API's message because that is the only signal it gives. A status code
 * alone cannot distinguish the two, and treating every 401 as "ask for the code" would
 * present the second step to someone who simply mistyped their password.
 */
function needsSecondFactor(body: unknown): boolean {
  const message = messageOf(body);

  return message !== null && /authenticator code required/i.test(message);
}

/**
 * The 401 stays vague because the API's does: login answers identically for an
 * unknown email and a wrong password so it cannot be used to enumerate accounts.
 * The 403 is specific, because by then the person has already proved the credentials
 * are theirs and the only useful thing to say is that this account is not staff.
 */
function describe(body: unknown, status: number): string {
  if (status === 401) {
    /**
     * By the time this runs the two-step flow has already handled "code required", so
     * a 401 here is either bad credentials at step one or a bad code at step two. The
     * API distinguishes them in English; `apiError` maps that onto Arabic rather than
     * putting a server string in the middle of an Arabic screen.
     */
    const message = messageOf(body);

    return message && /authenticator|recovery|code/i.test(message)
      ? apiError(message)
      : AR.errors.credentials;
  }

  if (status === 400) {
    // Almost always a malformed recovery code, since the code field accepts both shapes.
    return AR.errors.codeFormat;
  }

  if (status === 403) return AR.errors.notStaff;
  if (status === 423) return AR.errors.locked;
  if (status === 429) return AR.errors.tooMany;

  return apiError(messageOf(body));
}

function messageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;

  const { message } = body;

  return typeof message === 'string' ? message : null;
}

const Field = function Field({
  name,
  label,
  hint,
  ref,
  ...rest
}: {
  name: string;
  label: string;
  hint?: string;
  ref?: React.Ref<HTMLInputElement>;
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
        ref={ref}
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
};
