'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ERROR } from '@safra/contracts';
import { PasswordField } from '@safra/ui';

import { t } from '@/lib/strings';

/** Six digits is an authenticator code; anything else is treated as a recovery code. */
const TOTP_PATTERN = /^\d{6}$/;

/**
 * Partner sign-in, in two steps.
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
export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingCode, setAwaitingCode] = useState(false);

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

  /** Signed in: invalidate the signed-out server layout before navigating into it. */
  function enter(): void {
    router.refresh();
    router.replace('/');
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
        ...(TOTP_PATTERN.test(entered)
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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <h1 className="font-[family-name:var(--font-amiri)] text-3xl font-bold text-gold">
        {t.login.title}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {awaitingCode ? t.login.codeTitle : t.login.subtitle}
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {error}
        </p>
      ) : null}

      {awaitingCode ? (
        /* `void`: the handler is async and the attribute expects a void return. */
        <form
          onSubmit={(event) => {
            void submitCode(event);
          }}
          className="mt-6 grid gap-4"
        >
          <label className="grid gap-1.5">
            <span className="text-[12.5px] text-muted">{t.login.codeLabel}</span>
            {/*
              `dir="ltr"`: both a six-digit code and a XXXX-XXXX-XXXX recovery code are Latin runs,
              and the hyphens are bidi-neutral — without this they reorder on an RTL page.

              No `autoFocus`. The field is the only one on the step, and moving focus without the
              person asking is disorienting for a screen-reader user who has just been told the
              password was accepted.
            */}
            <input
              name="code"
              dir="ltr"
              inputMode="text"
              autoComplete="one-time-code"
              required
              className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-start text-text"
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="min-h-10 cursor-pointer rounded-lg bg-gold px-4 py-2.5 font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? t.login.codeChecking : t.login.codeSubmit}
          </button>

          <button
            type="button"
            onClick={() => {
              setAwaitingCode(false);
              setError(null);
            }}
            className="min-h-10 cursor-pointer rounded-lg border border-line px-4 py-2 text-[12.5px] text-faint hover:text-muted"
          >
            {t.login.codeBack}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            void submitCredentials(event);
          }}
          className="mt-6 grid gap-4"
        >
          <label className="grid gap-1.5">
            <span className="text-[12.5px] text-muted">{t.login.email}</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              defaultValue={email}
              className="min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-text"
            />
          </label>

          <PasswordField
            name="password"
            label={t.login.password}
            showLabel={t.login.showPassword}
            hideLabel={t.login.hidePassword}
            autoComplete="current-password"
          />

          <button
            type="submit"
            disabled={busy}
            className="min-h-10 cursor-pointer rounded-lg bg-gold px-4 py-2.5 font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? t.login.signingIn : t.login.submit}
          </button>
        </form>
      )}
    </main>
  );
}

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

  return code === ERROR.AUTH_CODE_REQUIRED;
}
