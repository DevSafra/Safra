'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t } from '@/lib/strings';

/**
 * Starts, pauses or resumes an ad campaign.
 *
 * A commercial act on something the advertiser paid for, so the API records who did it and why.
 * The reason here is fixed rather than prompted: the operator has already chosen a specific
 * campaign's button, and adding a modal between them and "stop showing this ad" is friction in the
 * wrong direction — an ad that must come down usually must come down now.
 *
 * ## A DRAFT starts here, and could not before
 *
 * `next` was `status === 'paused' ? 'active' : 'paused'`, so the only control on a freshly created
 * campaign said «إيقاف» and would have moved it from `draft` to `paused`. Every campaign is created
 * as a draft — deliberately, so the creative is confirmed before an advertiser's window begins —
 * which meant a campaign made in the console could never be made LIVE from the console. Found by
 * creating one and looking at the row.
 *
 * The question the button answers is «is it running?», not «was it ever running», so it is `active`
 * that flips to paused and everything else that flips to active.
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

  const next = status === 'active' ? 'paused' : 'active';

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
      className="inline-flex w-full cursor-pointer items-center justify-center whitespace-nowrap rounded-lg border border-line px-2.5 py-1 text-[10.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.5)] hover:text-gold disabled:opacity-50"
    >
      {busy
        ? t.sections.ads.pausing
        : next === 'paused'
          ? t.sections.ads.pause
          : t.sections.ads.resume}
    </button>
  );
}
