'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AR } from '@/lib/strings';

/**
 * Pauses or resumes an ad campaign.
 *
 * A commercial act on something the advertiser paid for, so the API records who did it and why.
 * The reason here is fixed rather than prompted: the operator has already chosen a specific
 * campaign's button, and adding a modal between them and "stop showing this ad" is friction in the
 * wrong direction — an ad that must come down usually must come down now.
 */
export function CampaignStatusButton({
  reference,
  status,
}: {
  reference: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const next = status === 'paused' ? 'active' : 'paused';

  async function toggle(): Promise<void> {
    setBusy(true);

    await fetch(`/api/ad-campaigns/${encodeURIComponent(reference)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: next,
        reason: `Set to ${next} from the console`,
      }),
    });

    setBusy(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void toggle()}
      className="cursor-pointer justify-self-start rounded-md border border-line px-2.5 py-0.5 text-[10.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.5)] hover:text-gold disabled:opacity-50"
    >
      {busy
        ? AR.sections.ads.pausing
        : next === 'paused'
          ? AR.sections.ads.pause
          : AR.sections.ads.resume}
    </button>
  );
}
