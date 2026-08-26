'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t, apiError } from '@/lib/strings';

/**
 * Pausing or resuming a campaign — the operator's switch, separate from the calendar.
 *
 * A coupon can be switched off without touching its dates, so a campaign that is going wrong stops
 * immediately and can be resumed. The registry already shows the two together with EXPIRY winning,
 * because a coupon switched on and past its window is not usable and saying «نشط» would send
 * somebody looking for a bug in checkout.
 *
 * There is no control on an expired coupon: switching one on changes nothing a customer can use,
 * and offering it would suggest otherwise.
 */
export function CouponActiveToggle({
  code,
  isActive,
}: {
  readonly code: string;
  readonly isActive: boolean;
}) {
  const router = useRouter();
  const c = t.sections.coupons;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/coupons/${encodeURIComponent(code)}/active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const message =
          typeof payload === 'object' && payload !== null && 'message' in payload
            ? String(payload.message)
            : null;

        setError(apiError(message));

        return;
      }

      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className={`min-h-10 cursor-pointer rounded-[8px] border px-2.5 py-1 text-[11px] font-bold transition-colors disabled:opacity-50 lg:min-h-0 ${
          isActive
            ? 'border-line text-muted hover:border-bad hover:text-bad'
            : 'border-[rgba(var(--goldA),0.4)] text-gold hover:bg-[rgba(var(--goldA),0.08)]'
        }`}
      >
        {busy ? t.table.working : isActive ? c.deactivate : c.activate}
      </button>
      {error ? <span className="text-[10.5px] text-bad">{error}</span> : null}
    </div>
  );
}
