'use client';

import { useEffect, useState } from 'react';
import { reloadInto } from '@safra/ui';
import { t } from '@/lib/strings';

interface Setup {
  otpauthUri: string;
  secret: string;
}

/**
 * The two-step enrolment the API already implements.
 *
 * Two steps rather than one, and that is the API's design showing through: `setup`
 * issues a PENDING secret and `enable` only commits it once a live code proves the
 * authenticator really has it. A one-shot enrolment would lock out anyone whose QR
 * scan silently failed — with no second factor to recover with.
 *
 * The secret is shown as text rather than a QR image on purpose: rendering a QR
 * would mean either an external image service (the secret leaves our infrastructure)
 * or a client-side QR library (a dependency on the one screen that must be
 * dependable). Manual entry is universally supported by authenticator apps.
 */
export function TwoFactorEnrolment() {
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
          setError(t.sections.panels.twoFactorStartFailed);
          return;
        }

        setSetup(body);
      } catch {
        if (!cancelled) setError(t.sections.panels.unreachable);
      }
    })();

    // Guards against the secret landing in state after an unmount — React 18's
    // strict-mode double-invoke makes that a real ordering, not a theoretical one.
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
            ? t.sections.panels.twoFactorCodeRejected
            : t.sections.panels.twoFactorFailed,
        );
        setBusy(false);
        return;
      }

      setRecoveryCodes(readRecoveryCodes(body));
      setBusy(false);
    } catch {
      setError(t.sections.panels.unreachable);
      setBusy(false);
    }
  }

  /**
   * Recovery codes are shown ONCE — they are hashed server-side and cannot be
   * retrieved. Continuing is a deliberate second click so they are not scrolled past.
   */
  if (recoveryCodes) {
    return (
      <div className="grid gap-4">
        <p className="rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm text-ok">
          {t.sections.twoFactor.enabled}
        </p>

        <div>
          <p className="text-sm text-text">{t.sections.twoFactor.saveRecoveryCodes}</p>
          <p className="mt-1 text-xs text-faint">
            {t.sections.twoFactor.recoveryCodesNote}
          </p>

          <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm text-text">
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
            // refresh() first: the new token carries totpEnabled, and middleware
            // reads it on the next request to let this person past the gate.
            /*
              A full document load — see `reloadInto`. Enrolment is the moment the session becomes
              usable: the middleware stops confining this account to `/enrol-2fa`, and a soft push
              would land on a dashboard rendered from a cache made while it was still confined.
            */
            reloadInto('/');
          }}
          className="cursor-pointer rounded-lg bg-gold px-5 py-3 font-semibold text-bg"
        >
          {t.sections.twoFactor.savedContinue}
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

      <ol className="grid gap-2 text-sm text-muted">
        <li>{t.sections.twoFactor.step1}</li>
        <li>{t.sections.twoFactor.step2}</li>
        <li>{t.sections.twoFactor.step3}</li>
      </ol>

      <div>
        <p className="text-xs text-faint">{t.sections.twoFactor.setupKey}</p>
        {/*
          `data-totp-secret` so the browser suite can read the key without walking the DOM.

          Added 2026-08-24 for `console-role-gating.spec.ts`, which is the only way this platform
          can drive a NARROW staff role end to end: staff must enrol an authenticator, and a spec
          can only do that because this secret is rendered as TEXT rather than a QR — see the
          docblock above for why it is text, which is a decision made for a different reason and
          happens to be what makes the whole refusal path testable.

          The spec had located it by sibling relationship — the paragraph after «مفتاح الإعداد» —
          which works and breaks the moment anybody wraps this in a `<div>`, with a timeout that
          reads as a broken enrolment rather than a moved element. A one-line hook is cheaper than
          that debugging session, and cheaper than the alternative: nobody ever proving a refusal
          renders.
        */}
        <p
          data-totp-secret
          className="mt-1 break-all rounded-lg border border-line bg-field px-3 py-2.5 font-mono text-sm text-text"
        >
          {setup?.secret ?? t.sections.panels.twoFactorLoading}
        </p>
      </div>

      <form onSubmit={(event) => void confirm(event)} className="grid gap-3">
        <label htmlFor="code" className="text-sm text-muted">
          {t.sections.twoFactor.sixDigitCode}
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          required
          disabled={!setup}
          className="rounded-lg border border-line bg-field px-3 py-2.5 text-text disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !setup}
          className="cursor-pointer rounded-lg bg-gold px-5 py-3 font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? t.sections.panels.twoFactorChecking : t.sections.panels.twoFactorSubmit}
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
