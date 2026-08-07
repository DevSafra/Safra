'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { t } from '@/lib/strings';

interface Setup {
  otpauthUri: string;
  secret: string;
}

/**
 * The two-step enrolment the API already implements.
 *
 * Two steps rather than one, and that is the API's design showing through: `setup` issues a
 * PENDING secret and `enable` only commits it once a live code proves the authenticator really has
 * it. A one-shot enrolment would lock out anyone whose scan silently failed — with no second
 * factor to recover with, and for a partner no colleague at the next desk to ask.
 *
 * The secret is shown as text rather than a QR image, the same call the console makes: rendering a
 * QR would mean either an external image service (the secret leaves our infrastructure) or a
 * client-side QR library (a dependency on the one screen that must be dependable). Manual entry is
 * universally supported by authenticator apps.
 *
 * ## Why the sign-out control is here
 *
 * This screen is a dead end by design — middleware lets an unenrolled partner reach nothing else.
 * Without a way out, somebody who opened the portal on a shared machine, or who simply is not
 * ready to enrol, has no option but to clear their cookies. The console does not need this because
 * its sign-out lives in a sidebar that is always present; here there is no sidebar yet.
 */
export function TwoFactorEnrolment() {
  const router = useRouter();

  const [setup, setSetup] = useState<Setup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/auth/2fa/setup', { method: 'POST' });
        const body: unknown = await response.json().catch(() => null);

        if (cancelled) return;

        if (!response.ok || !isSetup(body)) {
          setError(t.twoFactor.startFailed);
          return;
        }

        setSetup(body);
      } catch {
        if (!cancelled) setError(t.twoFactor.unreachable);
      }
    })();

    // Guards against the secret landing in state after an unmount — React's strict-mode
    // double-invoke makes that a real ordering, not a theoretical one.
    return () => {
      cancelled = true;
    };
  }, []);

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    const value = new FormData(event.currentTarget).get('code');
    const code = typeof value === 'string' ? value.trim() : '';

    try {
      const response = await fetch('/api/auth/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          response.status === 400 || response.status === 401
            ? t.twoFactor.codeRejected
            : t.twoFactor.failed,
        );
        setBusy(false);
        return;
      }

      setRecoveryCodes(readRecoveryCodes(body));
      setBusy(false);
    } catch {
      setError(t.twoFactor.unreachable);
      setBusy(false);
    }
  }

  /**
   * Recovery codes are shown ONCE — they are hashed server-side and cannot be retrieved.
   * Continuing is a deliberate second click so they are not scrolled past.
   */
  if (recoveryCodes) {
    return (
      <div className="grid gap-4">
        <p className="rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm text-ok">
          {t.twoFactor.enabled}
        </p>

        <div>
          <p className="text-sm text-text">{t.twoFactor.saveRecoveryCodes}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-faint">
            {t.twoFactor.recoveryCodesNote}
          </p>

          {/*
            `dir="ltr"` on the list, not on each code. The codes are Latin and the page is RTL, so
            without it the bidi algorithm reorders the hyphenated groups and somebody copying one
            off the screen types it back in the wrong order.
          */}
          <ul
            dir="ltr"
            className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm text-text"
          >
            {recoveryCodes.map((code) => (
              <li key={code} className="rounded border border-line bg-field px-2 py-1.5">
                {code}
              </li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          onClick={() => {
            // refresh() first: the new token carries totpEnabled, and middleware reads it on the
            // next request to let this person past the gate.
            router.refresh();
            router.push('/');
          }}
          className="min-h-10 cursor-pointer rounded-lg bg-gold px-5 py-3 font-semibold text-bg"
        >
          {t.twoFactor.savedContinue}
        </button>
      </div>
    );
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

      <ol className="grid gap-2 text-[13px] text-muted">
        <li>{t.twoFactor.step1}</li>
        <li>{t.twoFactor.step2}</li>
        <li>{t.twoFactor.step3}</li>
      </ol>

      <div>
        <p className="text-[12px] text-faint">{t.twoFactor.setupKey}</p>
        <p
          dir="ltr"
          className="mt-1 break-all rounded-lg border border-line bg-field px-3 py-2.5 font-mono text-sm text-text"
        >
          {setup?.secret ?? t.twoFactor.loading}
        </p>
      </div>

      <form onSubmit={(event) => void confirm(event)} className="grid gap-3">
        <label htmlFor="code" className="text-[13px] text-muted">
          {t.twoFactor.sixDigitCode}
        </label>
        <input
          id="code"
          name="code"
          dir="ltr"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          required
          disabled={!setup}
          className="min-h-10 rounded-lg border border-line bg-field px-3 py-2.5 text-text disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !setup}
          className="min-h-10 cursor-pointer rounded-lg bg-gold px-5 py-3 font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? t.twoFactor.checking : t.twoFactor.submit}
        </button>
      </form>

      {/* The way out of a screen that is otherwise a dead end. See the note above. */}
      <form action="/api/auth/logout" method="post">
        <button
          type="submit"
          className="min-h-10 w-full cursor-pointer rounded-lg border border-line px-4 py-2 text-[12.5px] text-faint hover:text-muted"
        >
          {t.twoFactor.signOut}
        </button>
      </form>
    </div>
  );
}

function isSetup(body: unknown): body is Setup {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as Record<string, unknown>)['secret'] === 'string' &&
    typeof (body as Record<string, unknown>)['otpauthUri'] === 'string'
  );
}

function readRecoveryCodes(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];

  const codes = (body as Record<string, unknown>)['recoveryCodes'];

  return Array.isArray(codes)
    ? codes.filter((c): c is string => typeof c === 'string')
    : [];
}
