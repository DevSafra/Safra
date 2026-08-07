'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { fill, t } from '@/lib/strings';

/**
 * Clearing a partner's second factor — the lost-phone path (§4.1 sensitive operation).
 *
 * ## What this control is careful NOT to be
 *
 * It does not show a code, does not accept one, and does not sign the partner in. It clears, and
 * the partner enrols again from their own session. That is the property worth protecting: a staff
 * member must never hold — even for a moment — a credential that authenticates as a partner.
 *
 * ## Why it asks twice
 *
 * The reason field is the second step rather than a field on the panel, so the destructive action
 * cannot be a single click on a page an operator opened to read something else. The API requires
 * the reason too; asking here is so the requirement is learned before the round trip, and so the
 * consequence — every session ends — is stated at the moment of deciding rather than after.
 */
export function PartnerTwoFactor({
  reference,
  enrolled,
}: {
  readonly reference: string;
  readonly enrolled: boolean;
}) {
  const router = useRouter();

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  async function submit(reason: string) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/partners/${reference}/two-factor-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setError(messageOf(body) ?? t.sections.partnerTwoFactor.failed);
        setBusy(false);
        return;
      }

      const body: unknown = await response.json().catch(() => null);

      setDone(sessionsRevokedIn(body));
      setConfirming(false);
      setBusy(false);
      router.refresh();
    } catch {
      setError(t.sections.partnerTwoFactor.unreachable);
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-text">
          {t.sections.partnerTwoFactor.title}
        </span>
        <span
          data-status-pill
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
            enrolled ? 'border-ok bg-ok/15 text-ok' : 'border-warn bg-warn/15 text-warn'
          }`}
        >
          {enrolled
            ? t.sections.partnerTwoFactor.enrolled
            : t.sections.partnerTwoFactor.notEnrolled}
        </span>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-muted">
        {t.sections.partnerTwoFactor.explain}
      </p>

      {error ? (
        <p role="alert" className="mb-3 text-xs text-bad">
          {error}
        </p>
      ) : null}

      {done !== null ? (
        <p role="status" className="mb-3 text-xs text-ok">
          {fill(t.sections.partnerTwoFactor.done, { n: done })}
        </p>
      ) : null}

      {confirming ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get('reason');
            void submit(typeof value === 'string' ? value : '');
          }}
        >
          <label htmlFor="two-factor-reason" className="text-xs text-muted">
            {t.sections.partnerTwoFactor.reasonLabel}
          </label>
          <textarea
            id="two-factor-reason"
            name="reason"
            rows={3}
            required
            minLength={3}
            className="rounded-lg border border-line bg-field px-3 py-2 text-sm text-text"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="cursor-pointer rounded-lg bg-bad px-4 py-2 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy
                ? t.sections.partnerTwoFactor.working
                : t.sections.partnerTwoFactor.confirm}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm text-muted"
            >
              {t.sections.settings.cancel}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDone(null);
            setConfirming(true);
          }}
          className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm text-muted hover:border-bad/50 hover:text-bad"
        >
          {t.sections.partnerTwoFactor.reset}
        </button>
      )}
    </div>
  );
}

function messageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;

  const { message } = body;
  return typeof message === 'string' ? message : null;
}

/** The count the API reports, or zero — never a guess presented as a fact. */
function sessionsRevokedIn(body: unknown): number {
  if (typeof body !== 'object' || body === null || !('sessionsRevoked' in body)) return 0;

  const { sessionsRevoked } = body;
  return typeof sessionsRevoked === 'number' ? sessionsRevoked : 0;
}
