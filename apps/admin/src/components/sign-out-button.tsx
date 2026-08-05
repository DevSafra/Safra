'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { t } from '@/lib/strings';

/**
 * Sign out.
 *
 * A POST, not a link: a GET that destroys a session is triggered by any prefetch or
 * link scanner that happens across it, which signs people out at random. The handler
 * also revokes the refresh family at the API, so this ends the session everywhere
 * rather than only in this browser — which is the point on a shared machine.
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);

    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignored: the handler clears the cookie regardless, so navigating on is what
      // completes the sign-out from this browser's point of view.
    }

    router.refresh();
    router.push('/login');
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm text-muted transition-colors hover:border-gold/50 hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? t.dashboard.signingOut : t.dashboard.signOut}
    </button>
  );
}
