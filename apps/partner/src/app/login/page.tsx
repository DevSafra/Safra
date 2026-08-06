'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { PasswordField } from '@safra/ui';

import { t } from '@/lib/strings';

/**
 * Partner sign-in.
 *
 * One step, unlike the console's two: the API asks a partner for no second factor, so a code step
 * here would be a form nobody can complete. See the note in `middleware.ts`.
 *
 * `PasswordField` rather than a raw input, per the project rule — a masked field with no way to
 * reveal it makes people mistype, and a mistyped password costs one of five attempts before the
 * account locks.
 */
export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    /*
      `FormData.get` returns `File | string | null`, and `String(aFile)` is `[object File]` — a
      password silently replaced by a constant. Narrowing to a string is the difference between a
      failed sign-in nobody can explain and a type error at build time.
    */
    const field = (name: string): string => {
      const value = form.get(name);

      return typeof value === 'string' ? value : '';
    };

    let response: Response;

    try {
      response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: field('email'),
          password: field('password'),
        }),
      });
    } catch {
      setError(t.login.unreachable);
      setBusy(false);

      return;
    }

    if (response.ok) {
      /*
        `refresh()` before `replace()`: the layout above this is a server component holding the
        signed-out state, and pushing without invalidating it renders the new route against the
        old session.
      */
      router.refresh();
      router.replace('/');

      return;
    }

    setError(response.status === 403 ? t.login.notAPartner : t.login.failed);
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <h1 className="font-[family-name:var(--font-amiri)] text-3xl font-bold text-gold">
        {t.login.title}
      </h1>
      <p className="mt-1 text-sm text-muted">{t.login.subtitle}</p>

      {/* `void`: the handler is async and the attribute expects a void return. */}
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        className="mt-8 grid gap-4"
      >
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
          >
            {error}
          </p>
        ) : null}

        <label className="grid gap-1.5">
          <span className="text-[12.5px] text-muted">{t.login.email}</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
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
    </main>
  );
}
