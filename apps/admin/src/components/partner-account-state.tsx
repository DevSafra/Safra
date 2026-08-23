'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { apiErrorOf, fill, t } from '@/lib/strings';

/**
 * Whether the partner can actually SIGN IN, and the remedy when they cannot
 * (Bashar, 2026-08-23).
 *
 * ## The defect this exists because of
 *
 * A partner was onboarded in person, documents filed, contract signed, approved — every step on
 * the checklist reading «تم» — and then could not sign in. The invitation had never been redeemed,
 * so the account was still a `customer` and the password on it was the one it had had as a
 * customer since long before. The operator had no way to know: nothing on the screen that had just
 * declared the job finished mentioned the account at all.
 *
 * And there was no remedy either. `O-partner-10` claimed the invitation was "re-sendable from the
 * screen"; it was not, because the only resend endpoint is keyed on an application reference and
 * an onboarded partner deliberately has no application. The capability was asserted, not built.
 *
 * ## Why it is a line under step ①, not a sixth step
 *
 * The other five are things the operator DOES. This is a thing they WAIT for: nobody in the room
 * can complete it, because only the person holding the mailbox can. Numbering it would put a step
 * on the checklist that the checklist can never tick, which reads as a blocked flow rather than a
 * pending one — and the rest of onboarding genuinely does not wait for it.
 *
 * ## The two unactivated states are told apart
 *
 * A live link outstanding is "wait, or nudge them"; an expired one is "nothing will arrive until
 * you act". Collapsing them would leave an operator waiting on a link that can no longer be
 * redeemed, which is the failure mode with no symptom.
 */
export function PartnerAccountState({
  reference,
  email,
  activated,
  invitationPending,
}: {
  readonly reference: string;
  readonly email: string;
  readonly activated: boolean;
  readonly invitationPending: boolean;
}) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function resend(): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);
    setDone(null);

    try {
      const response = await fetch(
        `/api/partner-onboarding/${encodeURIComponent(reference)}/resend-invitation`,
        { method: 'POST' },
      );

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);

        setError(apiErrorOf(payload));
        setBusy(false);

        return;
      }

      setDone(fill(t.sections.partnerOnboarding.resent, { email }));
      /* The state above is server-rendered, so the refresh is what re-reads it. */
      router.refresh();
      setBusy(false);
    } catch {
      setError(t.sections.partnerOnboarding.unreachable);
      setBusy(false);
    }
  }

  if (activated) {
    return (
      <p className="mt-2 text-[12px] text-ok">
        {t.sections.partnerOnboarding.accountActivated}
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2.5">
      <p className="text-[12px] leading-relaxed text-gold">
        {fill(
          invitationPending
            ? t.sections.partnerOnboarding.accountPending
            : t.sections.partnerOnboarding.accountPendingNoLink,
          { email },
        )}
      </p>

      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-bad">
          {error}
        </p>
      ) : null}

      {done ? (
        <p role="status" className="mt-2 text-[12px] text-ok">
          {done}
        </p>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => void resend()}
        className="mt-2 inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-gold/40 px-3 py-1.5 text-[12px] font-semibold text-gold hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
      >
        {busy
          ? t.sections.partnerOnboarding.resending
          : t.sections.partnerOnboarding.resendInvitation}
      </button>
    </div>
  );
}
