'use client';

import { useState } from 'react';
import { ERROR } from '@safra/contracts';
import { PasswordField, replaceInto } from '@safra/ui';

import { t } from '@/lib/strings';

/** Six digits is an authenticator code; anything else is treated as a recovery code. */
const TOTP_PATTERN = /^\d{6}$/;

/**
 * Partner sign-in, in two steps.
 *
 * ## A component, not a page
 *
 * Split out on 2026-08-13 so the partner sign-in screen is built the way the console's is: a SERVER
 * page holds the ornament, the heading and the card, and only the interactive part ships as client
 * JavaScript. Before, the whole screen was one `'use client'` page, so the layout and the copy were
 * bundled and hydrated to render text that never changes.
 *
 * Two rather than one since 2026-08-07, when partner 2FA became mandatory. The second step appears
 * only when the API says the credentials were ACCEPTED and the code is outstanding — never for a
 * mistyped password, which would present a code box to somebody who has nothing to type in it.
 *
 * A partner who has not yet enrolled never sees step two at all: the API asks for a code only from
 * accounts that already have one. They sign in on their password and middleware sends them to
 * `/enrol-2fa`. That is the migration path, and it is why the requirement could ship without
 * locking out every existing partner.
 *
 * `PasswordField` rather than a raw input, per the project rule — a masked field with no way to
 * reveal it makes people mistype, and a mistyped password costs one of five attempts before the
 * account locks.
 */
export function PartnerLoginForm({ next }: { readonly next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingCode, setAwaitingCode] = useState(false);
  /**
   * Whether the code was EMAILED rather than produced by an authenticator.
   *
   * Drives the wording of step two and whether the resend button is there at all — an
   * authenticator needs no resending, and offering it would be a button that does nothing.
   */
  const [byEmail, setByEmail] = useState(false);
  const [resent, setResent] = useState(false);

  /*
    Held in state across the two steps because the API's login is a single call that takes all
    three: there is no half-authenticated session to carry the credentials for us. Kept in memory
    only, never written anywhere.
  */
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function attempt(body: Record<string, string>) {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload: unknown = await response.json().catch(() => null);

    return { ok: response.ok, status: response.status, payload };
  }

  /**
   * Signed in: invalidate the signed-out server layout before navigating into it.
   *
   * `next` is where the middleware said they were going, already validated by `safeRedirect` on the
   * server. It was being DROPPED: the middleware sets `?next=` and says in its own comment that "the
   * login page re-validates it", and this form always went to `/` — so a partner who followed a link
   * to one of their calendars signed in and arrived at the dashboard instead. The browser suite
   * asserted the parameter was set and nothing asserted it was used.
   */
  function enter(): void {
    /*
      A full document load that REPLACES this page — see `replaceInto`. The same two-navigations
      race the console's sign-in had: `refresh()` refetches `/login`, where the middleware now sees
      a session and redirects away, while the navigation to `next` is still in flight.
    */
    replaceInto(next === '' ? '/' : next);
  }

  async function submitCredentials(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    /*
      `FormData.get` returns `File | string | null`, and `String(aFile)` is `[object File]` — a
      password silently replaced by a constant. Narrowing to a string is the difference between a
      failed sign-in nobody can explain and a type error at build time.
    */
    const form = new FormData(event.currentTarget);
    const field = (name: string): string => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };

    const enteredEmail = field('email').trim();
    const enteredPassword = field('password');

    setEmail(enteredEmail);
    setPassword(enteredPassword);

    try {
      const { ok, status, payload } = await attempt({
        email: enteredEmail,
        password: enteredPassword,
      });

      if (ok) {
        // No second factor on this account yet — signed in, and middleware holds it at enrolment.
        enter();
        return;
      }

      if (status === 401 && needsSecondFactor(payload)) {
        /*
          Which kind of code, so step two can say where to look. The API answers
          `auth.email_code_sent` for a partner who has no authenticator — the ordinary case since
          2026-08-20 — and `auth.code_required` for one who chose to enrol. Telling somebody to
          "open your authenticator app" when the code is sitting in their inbox is the whole reason
          these are two error codes rather than one.
        */
        setByEmail(codeOf(payload) === ERROR.AUTH_EMAIL_CODE_SENT);
        setAwaitingCode(true);
        setBusy(false);
        return;
      }

      setError(describe(status, false));
      setBusy(false);
    } catch {
      setError(t.login.unreachable);
      setBusy(false);
    }
  }

  /**
   * Asks for another code.
   *
   * The password goes with it, because the endpoint requires one — a resend that took only an
   * address would be a way to post mail at any inbox whose owner had an account here. It is
   * already in state from step one, so the partner is not asked for it twice.
   *
   * The answer is always `ok`, whatever the server decided, so there is nothing to distinguish and
   * nothing to leak. The message says a code was sent because from here it always was.
   */
  async function resendCode() {
    if (busy) return;

    setBusy(true);
    setError(null);
    setResent(false);

    try {
      const response = await fetch('/api/auth/login/resend-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) setResent(true);
      else setError(t.login.codeResendFailed);
    } catch {
      setError(t.login.unreachable);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    const value = new FormData(event.currentTarget).get('code');
    const entered = (typeof value === 'string' ? value : '').trim();

    try {
      /*
        One field, two kinds of secret. Asking somebody which one they are holding is a question
        they should not have to answer while locked out of their own dashboard.
      */
      const { ok, status } = await attempt({
        email,
        password,
        ...(byEmail
          ? /* An emailed code is always six digits — there is no recovery form of it. */
            { emailCode: entered }
          : TOTP_PATTERN.test(entered)
            ? { totpCode: entered }
            : { recoveryCode: entered.toUpperCase() }),
      });

      if (ok) {
        enter();
        return;
      }

      setError(describe(status, true));
      setBusy(false);
    } catch {
      setError(t.login.unreachable);
      setBusy(false);
    }
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
          /*
            A distinct key per step, copied from the console's form for the reason recorded there:
            React reuses a DOM node when the element type at a position is unchanged, so swapping one
            <input> for another RECYCLED it — and the code field arrived pre-filled with the password.
            Distinct keys force an unmount, which is what makes that impossible rather than unlikely.
          */
          key="second-factor"
          onSubmit={(event) => {
            void submitCode(event);
          }}
          noValidate
          className="grid gap-4"
        >
          <p className="text-sm text-muted">
            {t.login.signingInAs} <span className="text-text">{email.trim()}</span>
          </p>

          {/*
            `dir="ltr"`: a six-digit code and a XXXX-XXXX-XXXX recovery code are both Latin runs and
            the hyphens are bidi-neutral, so without this they reorder on an RTL page.
          */}
          <Field
            name="code"
            label={byEmail ? t.login.codeTitleEmail : t.login.codeTitle}
            hint={byEmail ? t.login.codeLabelEmail : t.login.codeLabel}
            dir="ltr"
            inputMode={byEmail ? 'numeric' : 'text'}
            autoComplete="one-time-code"
            required
          />

          {/*
            Resending only makes sense for a code somebody is WAITING for. An authenticator
            produces its own, so the button would do nothing but invite a press.
          */}
          {byEmail ? (
            <div className="grid gap-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void resendCode();
                }}
                className="w-fit cursor-pointer text-sm text-muted underline-offset-4 hover:text-gold hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? t.login.codeResending : t.login.codeResend}
              </button>
              {resent ? <p className="text-xs text-ok">{t.login.codeResent}</p> : null}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="mt-2 cursor-pointer rounded-lg bg-gold px-5 py-3 font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? t.login.codeChecking : t.login.codeSubmit}
          </button>

          {/* A way back, because the alternative is reloading the page. */}
          <button
            type="button"
            onClick={() => {
              setAwaitingCode(false);
              setError(null);
            }}
            className="cursor-pointer text-sm text-muted underline-offset-4 hover:text-gold hover:underline"
          >
            {t.login.codeBack}
          </button>
        </form>
      ) : (
        <form
          key="credentials"
          onSubmit={(event) => {
            void submitCredentials(event);
          }}
          noValidate
          className="grid gap-4"
        >
          <Field
            name="email"
            type="email"
            label={t.login.email}
            defaultValue={email}
            autoComplete="username"
            required
          />

          <PasswordField
            name="password"
            label={t.login.password}
            showLabel={t.login.showPassword}
            hideLabel={t.login.hidePassword}
            autoComplete="current-password"
            required
          />

          <button
            type="submit"
            disabled={busy}
            className="mt-2 cursor-pointer rounded-lg bg-gold px-5 py-3 font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? t.login.signingIn : t.login.submit}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * One labelled input, with the console's exact classes.
 *
 * A local copy rather than a shared component, and that is the same call the two apps already make
 * about `SupportForm`: they share the RULES through `@safra/contracts` and `@safra/ui`, not their
 * markup. What is shared here is the token vocabulary — `text-muted`, `bg-field`, `border-line` —
 * which is what actually makes the two screens look like one product.
 */
const Field = function Field({
  name,
  label,
  hint,
  ...rest
}: {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
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
};

/**
 * What to say about a refused sign-in.
 *
 * The distinction that earns its keep is 423 and 429. Reporting either as «بيانات الدخول غير
 * صحيحة» sends the person back to retype a password that was never the problem — which spends
 * another of the five attempts they get, and drives a throttled account into a real lockout. The
 * console makes the same distinction; the partner form did not, and the browser suite found it by
 * tripping the limiter and being told the credentials were wrong.
 */
function describe(status: number, onCodeStep: boolean): string {
  if (status === 403) return t.login.notAPartner;
  if (status === 423) return t.login.locked;
  if (status === 429) return t.login.tooMany;
  /* At step two the code field takes both shapes, so a 400 is almost always a malformed one. */
  if (status === 400 && onCodeStep) return t.login.codeFormat;

  return onCodeStep ? t.login.codeFailed : t.login.failed;
}

/**
 * Whether a 401 means "credentials fine, now the code" rather than a real failure.
 *
 * Matched on the CODE, never on prose. A status alone cannot distinguish the two, and treating
 * every 401 as "ask for the code" would present the second step to somebody who simply mistyped
 * their password. The console learned this the hard way: it matched the API's English message with
 * a regex, and that broke the moment the message became a code.
 */
function needsSecondFactor(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || !('code' in body)) return false;

  const { code } = body;

  return code === ERROR.AUTH_CODE_REQUIRED || code === ERROR.AUTH_EMAIL_CODE_SENT;
}

/** The error code in a response body, if it carries one. */
function codeOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('code' in body)) return null;

  const { code } = body;

  return typeof code === 'string' ? code : null;
}
