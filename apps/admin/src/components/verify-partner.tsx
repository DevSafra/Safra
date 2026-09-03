'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SanctionsPolicy } from '@safra/contracts';

import { apiErrorOf, t } from '@/lib/strings';

/**
 * The approve/reject decision (§8.1).
 *
 * Approval is disabled until screening is recorded, mirroring the API's own refusal
 * rather than replacing it. Doing it in both places is deliberate: the API is the
 * control, and this is so a reviewer learns the requirement before writing their
 * notes rather than after submitting them.
 *
 * Approving publishes nothing by itself, but it UNBLOCKS publication of every
 * listing this partner has submitted (item 116) — so the confirmation says so.
 */
export function VerifyPartner({
  reference,
  screened,
  contractActive,
  policy,
}: {
  reference: string;
  screened: boolean;
  /**
   * Whether a contract signed by BOTH parties is in force (Bashar, 2026-08-21).
   *
   * Advisory, exactly like the sanctions policy and for the same reason: the approval order is
   * generate → sign → countersign → approve, but a missing contract must not strand onboarding
   * the way the sanctions feed once did. The reviewer is told and the button works.
   */
  contractActive: boolean;
  /**
   * How hard sanctions screening bites (Bashar, 2026-08-21).
   *
   * This control used to disable «الموافقة على الشريك» whenever no screening was recorded — a
   * client-side mirror of the API's gate, and correct while that gate was unconditional. It is
   * not any more: under `advisory` the API approves, so a disabled button here would refuse a
   * decision the platform is willing to make, with no way for the reviewer to tell why.
   *
   * The API remains the boundary. This only decides what the screen offers.
   */
  policy: SanctionsPolicy;
}) {
  const router = useRouter();

  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: 'approve' | 'reject', notes: string) {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/partners/${reference}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        /*
          The CODE, resolved into Arabic — never the body's `message`.

          This read `message`, which `app-error.ts` documents as English prose kept for logs. On an
          Arabic-only console that put an English sentence in front of an operator, and §8.1's new
          document refusal was the one that made it visible (2026-08-26): «A partner cannot be
          approved before the verification documents are on file…». `apiErrorOf` is the shared
          helper that already does this, and it falls back to a generic Arabic line rather than to
          prose nobody here can read.
        */
        setError(apiErrorOf(body));
        setBusy(false);
        return;
      }

      router.refresh();
      setBusy(false);
    } catch {
      setError(t.sections.panels.unreachable);
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-card p-4">
      {/*
        Unscreened, and the warning says which world the reviewer is in. Nothing under `off`:
        screening is not offered at all there, so "no screening recorded" is not a fact anybody
        can act on and reads as an accusation about a control that was switched off deliberately.
      */}
      {/* Said before the screening note: a contract is the step that comes last. */}
      {!contractActive ? (
        <p className="mb-3 rounded border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-gold">
          {t.sections.partnerContract.notSignedYet}
        </p>
      ) : null}

      {!screened && policy !== 'off' ? (
        <p className="mb-3 rounded border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-gold">
          {policy === 'required'
            ? t.sections.verifyPartner.screeningRequired
            : t.sections.verifyPartner.screeningAdvisory}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mb-3 text-xs text-bad">
          {error}
        </p>
      ) : null}

      {mode === 'idle' ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!screened && policy === 'required'}
            onClick={() => setMode('approve')}
            title={
              screened || policy !== 'required'
                ? undefined
                : t.sections.verifyPartner.screeningRequiredTitle
            }
            className="cursor-pointer rounded-lg bg-ok px-4 py-2 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t.sections.verifyPartner.approve}
          </button>
          <button
            type="button"
            onClick={() => setMode('reject')}
            className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm text-muted hover:border-bad/50 hover:text-bad"
          >
            {t.sections.verifyPartner.reject}
          </button>
        </div>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get('notes');
            void submit(mode, typeof value === 'string' ? value : '');
          }}
        >
          <label htmlFor="decision-notes" className="text-xs text-muted">
            {mode === 'approve'
              ? t.sections.verifyPartner.notesOptional
              : t.sections.verifyPartner.rejectionReason}
          </label>
          <textarea
            id="decision-notes"
            name="notes"
            rows={3}
            required={mode === 'reject'}
            className="rounded-lg border border-line bg-field px-3 py-2 text-sm text-text"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60 ${
                mode === 'approve' ? 'bg-ok' : 'bg-bad'
              }`}
            >
              {busy
                ? t.sections.panels.saving
                : mode === 'approve'
                  ? t.sections.verifyPartner.confirmApproval
                  : t.sections.verifyPartner.confirmRejection}
            </button>
            <button
              type="button"
              onClick={() => setMode('idle')}
              className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm text-muted"
            >
              {t.sections.settings.cancel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
